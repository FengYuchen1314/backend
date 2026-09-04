//go:build windows

package updater

import (
	"errors"
	"os"
)

func replaceFile(source, destination string) error {
	err := os.Rename(source, destination)
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return err
	}
	if removeErr := os.Remove(destination); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
		return err
	}
	return os.Rename(source, destination)
}
