package updater

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type recordedCommand struct {
	executable string
	arguments  []string
}

type recordingRunner struct {
	commands []recordedCommand
	outputs  [][]byte
}

func (runner *recordingRunner) Run(_ context.Context, executable string, arguments ...string) ([]byte, error) {
	runner.commands = append(runner.commands, recordedCommand{executable: executable, arguments: append([]string(nil), arguments...)})
	if len(runner.outputs) > 0 {
		output := runner.outputs[0]
		runner.outputs = runner.outputs[1:]
		return output, nil
	}
	return []byte("ok"), nil
}

func TestDockerCurrentUsesExactConfiguredDigestWhenRepoDigestsAreEmpty(t *testing.T) {
	digest := "sha256:" + strings.Repeat("a", 64)
	exactRef := ImageRepository + "@" + digest
	runner := &recordingRunner{outputs: [][]byte{
		[]byte("sha256:local-image|" + exactRef + "|running|healthy\n"),
		[]byte(`[{"Id":"sha256:local-image","RepoDigests":[],"Config":{"Env":["__RW_METADATA_VERSION=3.4.3-xboard"],"Labels":{"io.xboard.updater.protocol":"1"}}}]`),
	}}
	engine := NewDockerEngine(Config{CommandTimeout: time.Second}, runner)
	current, err := engine.Current(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if current.Digest != digest || current.ConfiguredAs != exactRef {
		t.Fatalf("current image = %+v, want exact configured digest", current)
	}
}

func TestDockerPullKeepsResolvedIndexDigestWhenRepoDigestsDiffer(t *testing.T) {
	digest := "sha256:" + strings.Repeat("b", 64)
	exactRef := ImageRepository + "@" + digest
	platformDigest := "sha256:" + strings.Repeat("c", 64)
	runner := &recordingRunner{outputs: [][]byte{
		[]byte("pulled"),
		[]byte(`[{"Id":"sha256:local-image","RepoDigests":["` + ImageRepository + `@` + platformDigest + `"],"Config":{"Labels":{}}}]`),
	}}
	engine := NewDockerEngine(Config{CommandTimeout: time.Second}, runner)
	image, err := engine.Pull(context.Background(), exactRef)
	if err != nil {
		t.Fatal(err)
	}
	if image.Digest != digest || image.ConfiguredAs != exactRef {
		t.Fatalf("pulled image = %+v, want resolved index digest", image)
	}
}

func TestDockerLayoutRejectsAdvancedComposeBeforeDeployment(t *testing.T) {
	for _, test := range []struct {
		name    string
		output  string
		wantErr bool
	}{
		{name: "standard", output: "remnawave\nremnawave-db\nxboard-updater\n"},
		{name: "advanced", output: "remnawave\nremnawave-scheduler\n", wantErr: true},
		{name: "missing managed service", output: "remnawave-db\n", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			runner := &recordingRunner{outputs: [][]byte{[]byte(test.output)}}
			engine := NewDockerEngine(Config{DeployDir: "/opt/remnawave", BaseCompose: "base.yml", XboardCompose: "xboard.yml", ProjectName: "remnawave", CommandTimeout: time.Second}, runner)
			err := engine.ValidateLayout(context.Background())
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateLayout error = %v, wantErr=%v", err, test.wantErr)
			}
		})
	}
}

func TestDockerComposeUsesFixedExecutableAndArgumentArray(t *testing.T) {
	stateDir := t.TempDir()
	config := Config{
		DeployDir:      "/opt/remnawave",
		StateDir:       stateDir,
		BaseCompose:    "/opt/remnawave/docker-compose-prod.yml",
		XboardCompose:  "/opt/remnawave/docker-compose-xboard.yml",
		ProjectName:    "remnawave",
		CommandTimeout: time.Second,
	}
	runner := &recordingRunner{}
	engine := NewDockerEngine(config, runner)
	override := filepath.Join(stateDir, "operation-"+strings.Repeat("a", 32)+".yml")
	if err := engine.ComposeUp(context.Background(), override); err != nil {
		t.Fatal(err)
	}
	if len(runner.commands) != 1 {
		t.Fatalf("command count = %d, want 1", len(runner.commands))
	}
	command := runner.commands[0]
	if command.executable != "docker" {
		t.Fatalf("executable = %q, want docker", command.executable)
	}
	joined := strings.Join(command.arguments, "\x00")
	for _, expected := range []string{"compose", "--project-name\x00remnawave", "--pull\x00never", "--force-recreate", ManagedService} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("missing fixed compose argument %q in %q", expected, joined)
		}
	}
	if strings.Contains(joined, "sh\x00-c") || strings.Contains(joined, "bash\x00-c") {
		t.Fatalf("compose command unexpectedly invoked a shell: %q", joined)
	}
}

func TestDockerComposeRejectsOverrideOutsideStateDirectory(t *testing.T) {
	runner := &recordingRunner{}
	engine := NewDockerEngine(Config{StateDir: t.TempDir(), CommandTimeout: time.Second}, runner)
	if err := engine.ComposeUp(context.Background(), "/tmp/request-controlled.yml"); err == nil {
		t.Fatal("expected out-of-directory override rejection")
	}
	if len(runner.commands) != 0 {
		t.Fatal("docker was invoked for a rejected override")
	}
}

func TestDockerProbeUsesValidatedContainerPorts(t *testing.T) {
	runner := &recordingRunner{outputs: [][]byte{
		[]byte(`["APP_PORT=3100","METRICS_PORT=3101"]`),
		[]byte("healthy"),
		[]byte("panel"),
	}}
	engine := NewDockerEngine(Config{CommandTimeout: time.Second}, runner)
	if err := engine.probeManagedContainer(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(runner.commands) != 3 {
		t.Fatalf("command count = %d, want 3", len(runner.commands))
	}
	joined := strings.Join(runner.commands[1].arguments, "\x00") + "\n" + strings.Join(runner.commands[2].arguments, "\x00")
	if !strings.Contains(joined, "http://127.0.0.1:3101/health") || !strings.Contains(joined, "http://127.0.0.1:3100/") {
		t.Fatalf("custom container ports were not probed: %q", joined)
	}
}

func TestDockerProbeRejectsInvalidContainerPort(t *testing.T) {
	runner := &recordingRunner{outputs: [][]byte{[]byte(`["APP_PORT=70000"]`)}}
	engine := NewDockerEngine(Config{CommandTimeout: time.Second}, runner)
	if err := engine.probeManagedContainer(context.Background()); err == nil {
		t.Fatal("expected invalid APP_PORT to be rejected")
	}
	if len(runner.commands) != 1 {
		t.Fatalf("invalid port should fail before exec, got %d commands", len(runner.commands))
	}
}
