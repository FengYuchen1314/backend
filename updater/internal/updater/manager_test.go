package updater

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type fixedResolver struct {
	digest string
	err    error
}

func (resolver fixedResolver) Resolve(context.Context) (string, error) {
	return resolver.digest, resolver.err
}

type fakeEngine struct {
	mu                 sync.Mutex
	current            ImageInfo
	target             ImageInfo
	currentFingerprint string
	targetFingerprint  string
	databaseErr        error
	pullBlock          <-chan struct{}
	failTargetHealth   bool
	composeRefs        []string
}

func (engine *fakeEngine) Current(context.Context) (ImageInfo, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	return engine.current, nil
}

func (engine *fakeEngine) ValidateLayout(context.Context) error { return nil }

func (engine *fakeEngine) Pull(ctx context.Context, _ string) (ImageInfo, error) {
	if engine.pullBlock != nil {
		select {
		case <-engine.pullBlock:
		case <-ctx.Done():
			return ImageInfo{}, ctx.Err()
		}
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	return engine.target, nil
}

func (engine *fakeEngine) Preserve(_ context.Context, _ ImageInfo, operationID string) (string, error) {
	return "xboard-updater.local/backend:rollback-" + operationID, nil
}

func (engine *fakeEngine) DatabaseFingerprintForContainer(context.Context, string) (string, error) {
	return engine.currentFingerprint, nil
}

func (engine *fakeEngine) DatabaseFingerprintForImage(context.Context, string, string) (string, error) {
	return engine.targetFingerprint, nil
}

func (engine *fakeEngine) DatabaseIsCurrent(context.Context, string) error { return engine.databaseErr }

func (engine *fakeEngine) ComposeUp(_ context.Context, overridePath string) error {
	payload, err := os.ReadFile(overridePath)
	if err != nil {
		return err
	}
	ref := imageRefFromOverride(string(payload))
	if ref == "" {
		return errors.New("override did not contain an image")
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.composeRefs = append(engine.composeRefs, ref)
	engine.current.ConfiguredAs = ref
	if strings.HasPrefix(ref, ImageRepository+"@") {
		engine.current.Digest = strings.TrimPrefix(ref, ImageRepository+"@")
		engine.current.Version = engine.target.Version
		engine.current.Labels = engine.target.Labels
	}
	return nil
}

func (engine *fakeEngine) WaitHealthy(_ context.Context, expectedRef string) error {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if engine.failTargetHealth && strings.HasPrefix(expectedRef, ImageRepository+"@") {
		return errors.New("target did not become healthy")
	}
	return nil
}

func imageRefFromOverride(payload string) string {
	for _, line := range strings.Split(payload, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "image: ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "image: "))
		}
	}
	return ""
}

func TestManagerSuccessfulUpdatePinsExactDigest(t *testing.T) {
	manager, store, engine, targetDigest := newTestManager(t, nil)
	result := manager.Trigger()
	if !result.Accepted || result.State != TriggerQueued || result.OperationID == nil {
		t.Fatalf("unexpected trigger response: %+v", result)
	}
	journal := waitForJournal(t, store, func(journal Journal) bool { return journal.State == StatusSucceeded })
	if journal.TargetDigest != targetDigest || journal.Phase != "complete" {
		t.Fatalf("unexpected success journal: %+v", journal)
	}
	active, err := os.ReadFile(store.activePath)
	if err != nil {
		t.Fatal(err)
	}
	targetRef := ImageRepository + "@" + targetDigest
	if !strings.Contains(string(active), targetRef) || !strings.Contains(string(active), SkipDBBootstrapEnv) {
		t.Fatalf("active override was not safely pinned: %s", active)
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.composeRefs) != 1 || engine.composeRefs[0] != targetRef {
		t.Fatalf("unexpected compose calls: %v", engine.composeRefs)
	}
}

func TestManagerRollsBackFailedTargetHealth(t *testing.T) {
	manager, store, engine, _ := newTestManager(t, func(engine *fakeEngine) {
		engine.failTargetHealth = true
	})
	result := manager.Trigger()
	if !result.Accepted {
		t.Fatalf("update was not queued: %+v", result)
	}
	journal := waitForJournal(t, store, func(journal Journal) bool { return journal.State == StatusFailed && journal.Phase == "rolled-back" })
	if !journal.RollbackSucceeded || !strings.Contains(journal.LastError, "previous image was restored") {
		t.Fatalf("rollback was not recorded: %+v", journal)
	}
	active, err := os.ReadFile(store.activePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(active), ImageRepository+"@"+journal.PreviousDigest) {
		t.Fatalf("rollback did not persist the previous digest: %s", active)
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.composeRefs) != 2 || !strings.HasPrefix(engine.composeRefs[1], "xboard-updater.local/backend:rollback-") {
		t.Fatalf("expected target then rollback compose calls, got %v", engine.composeRefs)
	}
}

func TestManagerRejectsDatabaseFingerprintChangeBeforeCompose(t *testing.T) {
	manager, store, engine, _ := newTestManager(t, func(engine *fakeEngine) {
		engine.targetFingerprint = "different"
	})
	if result := manager.Trigger(); !result.Accepted {
		t.Fatalf("preflight operation should be queued: %+v", result)
	}
	journal := waitForJournal(t, store, func(journal Journal) bool { return journal.State == StatusFailed })
	if journal.Phase != "database-compatibility-failed" || !strings.Contains(journal.LastError, "manual") {
		t.Fatalf("unexpected database gate failure: %+v", journal)
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.composeRefs) != 0 {
		t.Fatalf("compose was called before database gate: %v", engine.composeRefs)
	}
}

func TestManagerSerializesConcurrentTriggers(t *testing.T) {
	release := make(chan struct{})
	manager, store, _, _ := newTestManager(t, func(engine *fakeEngine) {
		engine.pullBlock = release
	})
	first := manager.Trigger()
	if !first.Accepted || first.OperationID == nil {
		t.Fatalf("first update was not queued: %+v", first)
	}
	second := manager.Trigger()
	if second.Accepted || second.State != TriggerUpdating || second.OperationID == nil || *second.OperationID != *first.OperationID {
		t.Fatalf("second update was not serialized: %+v", second)
	}
	close(release)
	waitForJournal(t, store, func(journal Journal) bool { return journal.State == StatusSucceeded })
}

func TestManagerRecoversHealthyInterruptedTarget(t *testing.T) {
	manager, store, engine, targetDigest := newTestManager(t, nil)
	operationID := strings.Repeat("d", 32)
	targetRef := ImageRepository + "@" + targetDigest
	journal := newJournal(StatusUpdating, "deploying", operationID)
	journal.TargetDigest = targetDigest
	journal.TargetRef = targetRef
	journal.PreviousRef = "xboard-updater.local/backend:rollback-" + operationID
	if err := store.Save(journal); err != nil {
		t.Fatal(err)
	}
	engine.mu.Lock()
	engine.current.ConfiguredAs = targetRef
	engine.current.Digest = targetDigest
	engine.mu.Unlock()
	if err := manager.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != StatusSucceeded || recovered.Phase != "recovered-target" {
		t.Fatalf("unexpected recovered state: %+v", recovered)
	}
}

func newTestManager(t *testing.T, customize func(*fakeEngine)) (*Manager, *StateStore, *fakeEngine, string) {
	t.Helper()
	stateDir := t.TempDir()
	config := Config{
		DeployDir:      t.TempDir(),
		StateDir:       stateDir,
		BaseCompose:    "base.yml",
		XboardCompose:  "xboard.yml",
		ProjectName:    "remnawave",
		HealthTimeout:  time.Second,
		CommandTimeout: 2 * time.Second,
	}
	store := NewStateStore(stateDir)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	currentDigest := "sha256:" + strings.Repeat("1", 64)
	targetDigest := "sha256:" + strings.Repeat("2", 64)
	labels := map[string]string{UpdaterProtocolLabel: UpdaterProtocol, "org.opencontainers.image.source": ExpectedSource}
	engine := &fakeEngine{
		current:            ImageInfo{ImageID: "sha256:local-current", ConfiguredAs: ImageRepository + "@" + currentDigest, Digest: currentDigest, Version: "current", Labels: labels},
		target:             ImageInfo{ImageID: "sha256:local-target", ConfiguredAs: ImageRepository + "@" + targetDigest, Digest: targetDigest, Version: "target", Labels: labels},
		currentFingerprint: "same",
		targetFingerprint:  "same",
	}
	if customize != nil {
		customize(engine)
	}
	manager := NewManager(config, store, engine, fixedResolver{digest: targetDigest})
	return manager, store, engine, targetDigest
}

func waitForJournal(t *testing.T, store *StateStore, predicate func(Journal) bool) Journal {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		journal, err := store.Load()
		if err == nil && predicate(journal) {
			return journal
		}
		time.Sleep(10 * time.Millisecond)
	}
	journal, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	t.Fatalf("timed out waiting for updater journal; last state: %+v", journal)
	return Journal{}
}
