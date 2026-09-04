package updater

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	config   Config
	store    *StateStore
	engine   Engine
	resolver DigestResolver

	mu       sync.Mutex
	active   bool
	activeID string
}

func NewManager(config Config, store *StateStore, engine Engine, resolver DigestResolver) *Manager {
	return &Manager{config: config, store: store, engine: engine, resolver: resolver}
}

func (manager *Manager) Status(ctx context.Context) StatusResponse {
	journal, stateErr := manager.store.Load()
	if stateErr != nil {
		return failedStatus("Updater state could not be read", time.Now().UTC())
	}
	manager.mu.Lock()
	active := manager.active
	manager.mu.Unlock()
	if active || journal.State == StatusUpdating {
		return statusFromJournal(journal, StatusUpdating, true)
	}

	statusContext, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	type currentResult struct {
		image ImageInfo
		err   error
	}
	type targetResult struct {
		digest string
		err    error
	}
	currentChannel := make(chan currentResult, 1)
	targetChannel := make(chan targetResult, 1)
	go func() {
		image, err := manager.engine.Current(statusContext)
		currentChannel <- currentResult{image: image, err: err}
	}()
	go func() {
		digest, err := manager.resolver.Resolve(statusContext)
		targetChannel <- targetResult{digest: digest, err: err}
	}()
	currentOutcome := <-currentChannel
	targetOutcome := <-targetChannel
	current, currentErr := currentOutcome.image, currentOutcome.err
	targetDigest, targetErr := targetOutcome.digest, targetOutcome.err
	if currentErr != nil || targetErr != nil {
		message := "Update metadata could not be checked"
		return failedStatus(message, time.Now().UTC())
	}

	currentVersion := imageVersion(current)
	targetVersion := shortDigestVersion(targetDigest)
	updateAvailable := current.Digest == "" || current.Digest != targetDigest
	state := StatusIdle
	var lastError *string
	updatedAt := time.Now().UTC()
	if journal.UpdatedAt.IsZero() == false {
		updatedAt = journal.UpdatedAt.UTC()
	}
	if journal.TargetDigest == targetDigest {
		switch journal.State {
		case StatusSucceeded:
			state = StatusSucceeded
		case StatusFailed:
			state = StatusFailed
			if journal.LastError != "" {
				value := truncate(journal.LastError, maxPublicErrorLength)
				lastError = &value
			}
		}
	}
	if !updateAvailable && state != StatusFailed {
		if journal.State == StatusSucceeded {
			state = StatusSucceeded
		} else {
			state = StatusIdle
		}
	}
	return StatusResponse{
		Channel:         Channel,
		State:           state,
		CurrentVersion:  stringPointer(truncate(currentVersion, maxVersionLength)),
		TargetVersion:   stringPointer(truncate(targetVersion, maxVersionLength)),
		UpdateAvailable: updateAvailable,
		LastError:       lastError,
		UpdatedAt:       &updatedAt,
	}
}

func (manager *Manager) Trigger() TriggerResponse {
	manager.mu.Lock()
	if manager.active {
		operationID := manager.activeID
		manager.mu.Unlock()
		message := "An update is already in progress"
		return TriggerResponse{Accepted: false, OperationID: stringPointer(operationID), State: TriggerUpdating, Message: &message}
	}
	manager.mu.Unlock()

	lock, err := manager.store.AcquireLock()
	if err != nil {
		if errors.Is(err, ErrUpdateLocked) {
			journal, _ := manager.store.Load()
			message := "An update is already in progress"
			return TriggerResponse{Accepted: false, OperationID: nullableOperationID(journal.OperationID), State: TriggerUpdating, Message: &message}
		}
		message := "Updater lock could not be acquired"
		return TriggerResponse{Accepted: false, State: TriggerRejected, Message: &message}
	}

	operationID, err := randomOperationID()
	if err != nil {
		_ = lock.Close()
		message := "Update operation could not be created"
		return TriggerResponse{Accepted: false, State: TriggerRejected, Message: &message}
	}
	journal := newJournal(StatusUpdating, "queued", operationID)
	if err := manager.store.Save(journal); err != nil {
		_ = lock.Close()
		message := "Updater state could not be saved"
		return TriggerResponse{Accepted: false, State: TriggerRejected, Message: &message}
	}

	manager.mu.Lock()
	manager.active = true
	manager.activeID = operationID
	manager.mu.Unlock()
	go manager.runUpdate(journal, lock)
	return TriggerResponse{Accepted: true, OperationID: &operationID, State: TriggerQueued, Message: nil}
}

func (manager *Manager) Recover(ctx context.Context) error {
	journal, err := manager.store.Load()
	if err != nil {
		return err
	}
	if journal.State != StatusUpdating {
		return nil
	}
	lock, err := manager.store.AcquireLock()
	if err != nil {
		return fmt.Errorf("acquire recovery lock: %w", err)
	}
	defer lock.Close()
	if journal.PreviousRef == "" && journal.Phase != "deploying" && journal.Phase != "committing" && journal.Phase != "rolling-back" {
		journal.State = StatusFailed
		journal.Phase = "interrupted-before-deploy"
		journal.LastError = "Update was interrupted before the running service was changed"
		journal.UpdatedAt = time.Now().UTC()
		return manager.store.Save(journal)
	}

	if journal.TargetRef != "" {
		current, currentErr := manager.engine.Current(ctx)
		if currentErr == nil && imageMatches(current, journal.TargetRef, journal.TargetDigest) {
			healthContext, cancel := context.WithTimeout(ctx, manager.config.HealthTimeout)
			healthErr := manager.engine.WaitHealthy(healthContext, journal.TargetRef)
			cancel()
			if healthErr == nil {
				if err := manager.store.WriteActiveOverride(journal.TargetRef); err == nil {
					journal.State = StatusSucceeded
					journal.Phase = "recovered-target"
					journal.LastError = ""
					journal.UpdatedAt = time.Now().UTC()
					return manager.store.Save(journal)
				}
			}
		}
	}
	return manager.rollback(ctx, &journal, "Update was interrupted; the previous image was restored")
}

func (manager *Manager) runUpdate(journal Journal, lock UpdateLock) {
	defer func() {
		_ = lock.Close()
		manager.mu.Lock()
		manager.active = false
		manager.activeID = ""
		manager.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), manager.config.CommandTimeout+manager.config.HealthTimeout+2*time.Minute)
	defer cancel()
	destructive := false
	operationOverride := ""
	defer func() { manager.store.RemoveOperationOverride(operationOverride) }()

	fail := func(phase string, cause error) {
		log.Printf("updater operation %s failed during %s", journal.OperationID, phase)
		if destructive && journal.PreviousRef != "" {
			if rollbackErr := manager.rollback(context.Background(), &journal, "Update failed; the previous image was restored"); rollbackErr == nil {
				return
			} else {
				log.Printf("updater operation %s rollback failed", journal.OperationID)
				journal.LastError = "Update and automatic rollback failed; manual recovery is required"
			}
		} else {
			journal.LastError = publicFailureForPhase(phase)
		}
		journal.State = StatusFailed
		journal.Phase = phase + "-failed"
		journal.UpdatedAt = time.Now().UTC()
		_ = manager.store.Save(journal)
	}

	targetDigest, err := manager.resolver.Resolve(ctx)
	if err != nil {
		fail("resolve", err)
		return
	}
	targetRef, err := exactImageRef(targetDigest)
	if err != nil {
		fail("resolve", err)
		return
	}
	journal.TargetDigest = targetDigest
	journal.TargetRef = targetRef
	journal.TargetVersion = shortDigestVersion(targetDigest)
	journal.Phase = "preflight"
	journal.UpdatedAt = time.Now().UTC()
	_ = manager.store.Save(journal)

	current, err := manager.engine.Current(ctx)
	if err != nil {
		fail("inspect-current", err)
		return
	}
	if err := validateManagedImage(current); err != nil {
		fail("validate-current", err)
		return
	}
	if err := manager.engine.ValidateLayout(ctx); err != nil {
		fail("validate-layout", err)
		return
	}
	if current.Digest != "" && current.Digest == targetDigest {
		if err := manager.store.WriteActiveOverride(targetRef); err != nil {
			fail("commit", err)
			return
		}
		journal.State = StatusSucceeded
		journal.Phase = "already-current"
		journal.CurrentVersion = imageVersion(current)
		journal.TargetVersion = imageVersion(current)
		journal.UpdatedAt = time.Now().UTC()
		_ = manager.store.Save(journal)
		return
	}
	journal.CurrentVersion = imageVersion(current)
	journal.PreviousDigest = current.Digest

	target, err := manager.engine.Pull(ctx, targetRef)
	if err != nil {
		fail("pull", err)
		return
	}
	if target.Digest != targetDigest {
		fail("verify-digest", fmt.Errorf("pulled image digest did not match resolved digest"))
		return
	}
	if err := validateManagedImage(target); err != nil {
		fail("validate-target", err)
		return
	}
	journal.TargetVersion = imageVersion(target)
	journal.Phase = "database-gate"
	journal.UpdatedAt = time.Now().UTC()
	_ = manager.store.Save(journal)

	if err := manager.engine.DatabaseIsCurrent(ctx, ManagedContainer); err != nil {
		fail("database-status", err)
		return
	}
	currentFingerprint, err := manager.engine.DatabaseFingerprintForContainer(ctx, ManagedContainer)
	if err != nil {
		fail("fingerprint-current", err)
		return
	}
	targetFingerprint, err := manager.engine.DatabaseFingerprintForImage(ctx, targetRef, journal.OperationID)
	if err != nil {
		fail("fingerprint-target", err)
		return
	}
	if currentFingerprint != targetFingerprint {
		fail("database-compatibility", fmt.Errorf("database schema or migrations changed"))
		return
	}

	previousRef, err := manager.engine.Preserve(ctx, current, journal.OperationID)
	if err != nil {
		fail("preserve", err)
		return
	}
	journal.PreviousRef = previousRef
	operationOverride, err = manager.store.WriteOperationOverride(journal.OperationID, targetRef)
	if err != nil {
		fail("prepare", err)
		return
	}
	journal.Phase = "deploying"
	journal.UpdatedAt = time.Now().UTC()
	if err := manager.store.Save(journal); err != nil {
		fail("journal", err)
		return
	}
	destructive = true
	if err := manager.engine.ComposeUp(ctx, operationOverride); err != nil {
		fail("deploy", err)
		return
	}
	healthContext, healthCancel := context.WithTimeout(ctx, manager.config.HealthTimeout)
	err = manager.engine.WaitHealthy(healthContext, targetRef)
	healthCancel()
	if err != nil {
		fail("health", err)
		return
	}
	journal.Phase = "committing"
	journal.UpdatedAt = time.Now().UTC()
	if err := manager.store.Save(journal); err != nil {
		fail("journal", err)
		return
	}
	if err := manager.store.WriteActiveOverride(targetRef); err != nil {
		fail("commit", err)
		return
	}
	journal.State = StatusSucceeded
	journal.Phase = "complete"
	journal.LastError = ""
	journal.RollbackSucceeded = false
	journal.UpdatedAt = time.Now().UTC()
	if err := manager.store.Save(journal); err != nil {
		log.Printf("updater operation %s completed but final state could not be saved: %v", journal.OperationID, err)
	}
}

func (manager *Manager) rollback(ctx context.Context, journal *Journal, message string) error {
	if journal.PreviousRef == "" {
		journal.State = StatusFailed
		journal.Phase = "rollback-unavailable"
		journal.LastError = "Update was interrupted and no rollback image was recorded; manual recovery is required"
		journal.UpdatedAt = time.Now().UTC()
		_ = manager.store.Save(*journal)
		return fmt.Errorf("rollback image is unavailable")
	}
	journal.Phase = "rolling-back"
	journal.UpdatedAt = time.Now().UTC()
	_ = manager.store.Save(*journal)
	override, err := manager.store.WriteOperationOverride(journal.OperationID, journal.PreviousRef)
	if err != nil {
		return err
	}
	defer manager.store.RemoveOperationOverride(override)
	rollbackContext, cancel := context.WithTimeout(ctx, manager.config.CommandTimeout+manager.config.HealthTimeout)
	defer cancel()
	if err := manager.engine.ComposeUp(rollbackContext, override); err != nil {
		return err
	}
	healthContext, healthCancel := context.WithTimeout(rollbackContext, manager.config.HealthTimeout)
	err = manager.engine.WaitHealthy(healthContext, journal.PreviousRef)
	healthCancel()
	if err != nil {
		return err
	}
	activeRef := journal.PreviousRef
	if journal.PreviousDigest != "" {
		if exactPreviousRef, exactErr := exactImageRef(journal.PreviousDigest); exactErr == nil {
			activeRef = exactPreviousRef
		}
	}
	if err := manager.store.WriteActiveOverride(activeRef); err != nil {
		return err
	}
	journal.State = StatusFailed
	journal.Phase = "rolled-back"
	journal.LastError = truncate(message, maxPublicErrorLength)
	journal.RollbackSucceeded = true
	journal.UpdatedAt = time.Now().UTC()
	return manager.store.Save(*journal)
}

func validateManagedImage(image ImageInfo) error {
	if image.Labels[UpdaterProtocolLabel] != UpdaterProtocol {
		return fmt.Errorf("image does not support updater protocol %s", UpdaterProtocol)
	}
	if image.Labels["org.opencontainers.image.source"] != ExpectedSource {
		return fmt.Errorf("image source label is outside the allowlist")
	}
	return nil
}

func imageMatches(image ImageInfo, reference, digest string) bool {
	return image.ConfiguredAs == reference || (digest != "" && image.Digest == digest)
}

func imageVersion(image ImageInfo) string {
	version := strings.TrimSpace(image.Version)
	if version != "" {
		return truncate(version, maxVersionLength)
	}
	if image.Digest != "" {
		return shortDigestVersion(image.Digest)
	}
	return "unknown"
}

func statusFromJournal(journal Journal, state string, updateAvailable bool) StatusResponse {
	updatedAt := journal.UpdatedAt.UTC()
	if journal.UpdatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	var lastError *string
	if journal.LastError != "" {
		value := truncate(journal.LastError, maxPublicErrorLength)
		lastError = &value
	}
	return StatusResponse{
		Channel:         Channel,
		State:           state,
		CurrentVersion:  stringPointer(truncate(journal.CurrentVersion, maxVersionLength)),
		TargetVersion:   stringPointer(truncate(journal.TargetVersion, maxVersionLength)),
		UpdateAvailable: updateAvailable,
		LastError:       lastError,
		UpdatedAt:       &updatedAt,
	}
}

func failedStatus(message string, updatedAt time.Time) StatusResponse {
	message = truncate(message, maxPublicErrorLength)
	return StatusResponse{Channel: Channel, State: StatusFailed, UpdateAvailable: false, LastError: &message, UpdatedAt: &updatedAt}
}

func publicFailureForPhase(phase string) string {
	switch phase {
	case "database-status", "fingerprint-current", "fingerprint-target", "database-compatibility":
		return "This release changes database bootstrap inputs and requires a manual, backed-up upgrade"
	case "validate-current":
		return "The running image is not an updater-compatible Xboard build; install a compatible baseline manually"
	case "validate-target", "verify-digest":
		return "The target image failed updater safety checks"
	case "resolve", "pull":
		return "The target image could not be downloaded"
	default:
		return "The update failed before the running service was changed"
	}
}

func randomOperationID() (string, error) {
	payload := make([]byte, 16)
	if _, err := rand.Read(payload); err != nil {
		return "", err
	}
	return hex.EncodeToString(payload), nil
}

func isOperationID(value string) bool {
	if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func nullableOperationID(value string) *string {
	if !isOperationID(value) {
		return nil
	}
	return &value
}

func stringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func truncate(value string, maximum int) string {
	if len(value) <= maximum {
		return value
	}
	return value[:maximum]
}
