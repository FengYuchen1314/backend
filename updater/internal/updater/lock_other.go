//go:build !linux

package updater

import (
	"errors"
	"os"
)

var ErrUpdateLocked = errors.New("an update is already in progress")

type UpdateLock interface {
	Close() error
}

type exclusiveFileLock struct {
	file *os.File
	path string
}

func acquireUpdateLock(path string) (UpdateLock, error) {
	file, err := os.OpenFile(path+".exclusive", os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if errors.Is(err, os.ErrExist) {
		return nil, ErrUpdateLocked
	}
	if err != nil {
		return nil, err
	}
	return &exclusiveFileLock{file: file, path: path + ".exclusive"}, nil
}

func (lock *exclusiveFileLock) Close() error {
	closeErr := lock.file.Close()
	removeErr := os.Remove(lock.path)
	if closeErr != nil {
		return closeErr
	}
	return removeErr
}
