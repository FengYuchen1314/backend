package updater

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxStateBytes = 64 * 1024

type StateStore struct {
	dir        string
	statePath  string
	activePath string
	lockPath   string
}

func NewStateStore(dir string) *StateStore {
	return &StateStore{
		dir:        dir,
		statePath:  filepath.Join(dir, "state.json"),
		activePath: filepath.Join(dir, "active-compose.yml"),
		lockPath:   filepath.Join(dir, "update.lock"),
	}
}

func (store *StateStore) Ensure() error {
	if err := os.MkdirAll(store.dir, 0o700); err != nil {
		return fmt.Errorf("create updater state directory: %w", err)
	}
	return os.Chmod(store.dir, 0o700)
}

func (store *StateStore) Load() (Journal, error) {
	file, err := os.Open(store.statePath)
	if errors.Is(err, os.ErrNotExist) {
		return Journal{}, nil
	}
	if err != nil {
		return Journal{}, fmt.Errorf("open updater state: %w", err)
	}
	defer file.Close()

	payload, err := io.ReadAll(io.LimitReader(file, maxStateBytes+1))
	if err != nil {
		return Journal{}, fmt.Errorf("read updater state: %w", err)
	}
	if len(payload) > maxStateBytes {
		return Journal{}, fmt.Errorf("updater state exceeds the size limit")
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var journal Journal
	if err := decoder.Decode(&journal); err != nil {
		return Journal{}, fmt.Errorf("decode updater state: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Journal{}, fmt.Errorf("decode updater state: trailing JSON value")
	}
	if journal.Channel != "" && journal.Channel != Channel {
		return Journal{}, fmt.Errorf("updater state has an unsupported channel")
	}
	return journal, nil
}

func (store *StateStore) Save(journal Journal) error {
	journal.Channel = Channel
	journal.UpdatedAt = journal.UpdatedAt.UTC()
	payload, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return fmt.Errorf("encode updater state: %w", err)
	}
	payload = append(payload, '\n')
	return store.atomicWrite(store.statePath, payload, 0o600)
}

func (store *StateStore) WriteActiveOverride(imageRef string) error {
	if err := validateDeployRef(imageRef); err != nil {
		return err
	}
	payload := []byte("services:\n  remnawave:\n    image: " + imageRef + "\n    environment:\n      XBOARD_SKIP_DB_BOOTSTRAP: \"1\"\n")
	return store.atomicWrite(store.activePath, payload, 0o600)
}

func (store *StateStore) WriteOperationOverride(operationID, imageRef string) (string, error) {
	if !isOperationID(operationID) {
		return "", fmt.Errorf("invalid operation identifier")
	}
	if err := validateDeployRef(imageRef); err != nil {
		return "", err
	}
	path := filepath.Join(store.dir, "operation-"+operationID+".yml")
	payload := []byte("services:\n  remnawave:\n    image: " + imageRef + "\n    environment:\n      XBOARD_SKIP_DB_BOOTSTRAP: \"1\"\n")
	if err := store.atomicWrite(path, payload, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func (store *StateStore) RemoveOperationOverride(path string) {
	if filepath.Dir(path) == store.dir {
		_ = os.Remove(path)
	}
}

func (store *StateStore) AcquireLock() (UpdateLock, error) {
	return acquireUpdateLock(store.lockPath)
}

func (store *StateStore) atomicWrite(path string, payload []byte, mode os.FileMode) error {
	file, err := os.CreateTemp(store.dir, ".xboard-write-*")
	if err != nil {
		return fmt.Errorf("create temporary updater file: %w", err)
	}
	temporaryPath := file.Name()
	defer func() {
		_ = file.Close()
		_ = os.Remove(temporaryPath)
	}()
	if err := file.Chmod(mode); err != nil {
		return fmt.Errorf("set updater file mode: %w", err)
	}
	if _, err := file.Write(payload); err != nil {
		return fmt.Errorf("write updater file: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync updater file: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close updater file: %w", err)
	}
	if err := replaceFile(temporaryPath, path); err != nil {
		return fmt.Errorf("replace updater file: %w", err)
	}
	if directory, err := os.Open(store.dir); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}

func newJournal(state, phase, operationID string) Journal {
	return Journal{
		Channel:     Channel,
		State:       state,
		Phase:       phase,
		OperationID: operationID,
		UpdatedAt:   time.Now().UTC(),
	}
}
