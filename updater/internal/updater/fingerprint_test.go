package updater

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDatabaseFingerprintIsDeterministicAndContentSensitive(t *testing.T) {
	first := createFingerprintTree(t, "CREATE TABLE test (id int);")
	second := createFingerprintTree(t, "CREATE TABLE test (id int);")
	firstHash, err := databaseFingerprint(first)
	if err != nil {
		t.Fatal(err)
	}
	secondHash, err := databaseFingerprint(second)
	if err != nil {
		t.Fatal(err)
	}
	if firstHash != secondHash {
		t.Fatalf("equal trees produced different fingerprints")
	}
	if err := os.WriteFile(filepath.Join(second, "migrations", "001", "migration.sql"), []byte("ALTER TABLE test ADD name text;"), 0o600); err != nil {
		t.Fatal(err)
	}
	changedHash, err := databaseFingerprint(second)
	if err != nil {
		t.Fatal(err)
	}
	if changedHash == firstHash {
		t.Fatalf("changed migration did not change fingerprint")
	}
	seedBefore, err := databaseFingerprint(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(first, "seed.js"), []byte("runDataMigrationV2();"), 0o600); err != nil {
		t.Fatal(err)
	}
	seedAfter, err := databaseFingerprint(first)
	if err != nil {
		t.Fatal(err)
	}
	if seedAfter == seedBefore {
		t.Fatalf("changed compiled seed did not change fingerprint")
	}
}

func TestDatabaseFingerprintRejectsIncompleteInput(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "schema.prisma"), []byte("schema"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := databaseFingerprint(directory); err == nil {
		t.Fatal("expected incomplete fingerprint input to fail")
	}
}

func createFingerprintTree(t *testing.T, migration string) string {
	t.Helper()
	directory := t.TempDir()
	migrationDirectory := filepath.Join(directory, "migrations", "001")
	if err := os.MkdirAll(migrationDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "schema.prisma"), []byte("model Test { id Int @id }"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(migrationDirectory, "migration.sql"), []byte(migration), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "seed.js"), []byte("runDataMigrationV1();"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "docker-entrypoint.sh"), []byte("#!/bin/sh\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return directory
}
