package updater

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestStateStoreRoundTripLockAndActiveOverride(t *testing.T) {
	directory := t.TempDir()
	store := NewStateStore(directory)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	journal := newJournal(StatusUpdating, "queued", strings.Repeat("a", 32))
	journal.TargetDigest = "sha256:" + strings.Repeat("b", 64)
	if err := store.Save(journal); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.OperationID != journal.OperationID || loaded.TargetDigest != journal.TargetDigest {
		t.Fatalf("unexpected journal round trip: %+v", loaded)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(directory, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("state mode = %o, want 600", info.Mode().Perm())
		}
	}

	targetRef := ImageRepository + "@sha256:" + strings.Repeat("c", 64)
	if err := store.WriteActiveOverride(targetRef); err != nil {
		t.Fatal(err)
	}
	active, err := os.ReadFile(filepath.Join(directory, "active-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(active), targetRef) || !strings.Contains(string(active), "XBOARD_SKIP_DB_BOOTSTRAP") {
		t.Fatalf("unsafe or incomplete active override: %s", active)
	}

	lock, err := store.AcquireLock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcquireLock(); err != ErrUpdateLocked {
		t.Fatalf("second lock error = %v, want ErrUpdateLocked", err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	secondLock, err := store.AcquireLock()
	if err != nil {
		t.Fatal(err)
	}
	_ = secondLock.Close()
}

func TestStateStoreRejectsCorruptAndOversizedState(t *testing.T) {
	store := NewStateStore(t.TempDir())
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	for _, payload := range [][]byte{
		[]byte(`{"channel":"other"}`),
		[]byte(`{"channel":"xboard-dev"}{}`),
		[]byte(strings.Repeat("x", maxStateBytes+1)),
	} {
		if err := os.WriteFile(store.statePath, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Load(); err == nil {
			t.Fatalf("expected state rejection for %d-byte payload", len(payload))
		}
	}
}

func TestStatusFromJournalUsesUTC(t *testing.T) {
	journal := Journal{State: StatusUpdating, UpdatedAt: time.Date(2026, 9, 4, 12, 0, 0, 0, time.FixedZone("test", 8*60*60))}
	status := statusFromJournal(journal, StatusUpdating, true)
	if status.UpdatedAt == nil || status.UpdatedAt.Location() != time.UTC {
		t.Fatalf("updatedAt was not normalized to UTC: %v", status.UpdatedAt)
	}
}
