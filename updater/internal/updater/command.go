package updater

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

const maxCommandOutput = 1 << 20

type CommandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, executable string, arguments ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, arguments...)
	var stdout limitedBuffer
	var stderr limitedBuffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if len(message) > 4_096 {
			message = message[len(message)-4_096:]
		}
		if message == "" {
			message = "command failed without diagnostic output"
		}
		return nil, fmt.Errorf("%s failed: %s: %w", executable, message, err)
	}
	if stdout.overflow || stderr.overflow {
		return nil, fmt.Errorf("%s exceeded the command output limit", executable)
	}
	return stdout.Bytes(), nil
}

type limitedBuffer struct {
	buffer   bytes.Buffer
	overflow bool
}

func (buffer *limitedBuffer) Write(payload []byte) (int, error) {
	originalLength := len(payload)
	remaining := maxCommandOutput - buffer.buffer.Len()
	if remaining <= 0 {
		buffer.overflow = true
		return originalLength, nil
	}
	if len(payload) > remaining {
		payload = payload[:remaining]
		buffer.overflow = true
	}
	_, _ = buffer.buffer.Write(payload)
	return originalLength, nil
}

func (buffer *limitedBuffer) Bytes() []byte {
	return buffer.buffer.Bytes()
}

func (buffer *limitedBuffer) String() string {
	return buffer.buffer.String()
}
