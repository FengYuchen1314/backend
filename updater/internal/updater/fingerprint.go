package updater

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxFingerprintFiles = 2_048
	maxFingerprintBytes = 64 << 20
)

func databaseFingerprint(root string) (string, error) {
	var paths []string
	var totalBytes int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("database fingerprint contains a symbolic link")
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("database fingerprint contains a non-regular file")
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if relative == ".." || strings.HasPrefix(relative, "../") {
			return fmt.Errorf("database fingerprint escaped its root")
		}
		paths = append(paths, relative)
		totalBytes += info.Size()
		if len(paths) > maxFingerprintFiles || totalBytes > maxFingerprintBytes {
			return fmt.Errorf("database fingerprint input is too large")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if len(paths) < 2 {
		return "", fmt.Errorf("database fingerprint is incomplete")
	}
	sort.Strings(paths)
	hash := sha256.New()
	for _, relative := range paths {
		pathBytes := []byte(relative)
		if err := binary.Write(hash, binary.BigEndian, uint32(len(pathBytes))); err != nil {
			return "", err
		}
		_, _ = hash.Write(pathBytes)
		file, err := os.Open(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			return "", err
		}
		info, err := file.Stat()
		if err != nil {
			_ = file.Close()
			return "", err
		}
		if err := binary.Write(hash, binary.BigEndian, uint64(info.Size())); err != nil {
			_ = file.Close()
			return "", err
		}
		if _, err := io.Copy(hash, file); err != nil {
			_ = file.Close()
			return "", err
		}
		if err := file.Close(); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
