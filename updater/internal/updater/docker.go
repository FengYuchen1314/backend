package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type DockerEngine struct {
	config Config
	runner CommandRunner
}

func NewDockerEngine(config Config, runner CommandRunner) *DockerEngine {
	return &DockerEngine{config: config, runner: runner}
}

type dockerContainerInspect struct {
	Image  string
	Config struct {
		Image string
	}
	State struct {
		Status string
		Health *struct {
			Status string
		}
	}
}

type dockerImageInspect struct {
	ID          string            `json:"Id"`
	RepoDigests []string          `json:"RepoDigests"`
	Config      dockerImageConfig `json:"Config"`
}

type dockerImageConfig struct {
	Env    []string          `json:"Env"`
	Labels map[string]string `json:"Labels"`
}

func (engine *DockerEngine) Current(ctx context.Context) (ImageInfo, error) {
	container, err := engine.inspectContainer(ctx)
	if err != nil {
		return ImageInfo{}, fmt.Errorf("inspect managed container: %w", err)
	}
	image, err := engine.inspectImage(ctx, container.Image)
	if err != nil {
		return ImageInfo{}, err
	}
	image.ConfiguredAs = container.Config.Image
	if configuredDigest := digestFromConfiguredRef(image.ConfiguredAs); configuredDigest != "" {
		image.Digest = configuredDigest
	}
	return image, nil
}

func (engine *DockerEngine) ValidateLayout(ctx context.Context) error {
	output, err := engine.run(ctx,
		"compose",
		"--project-directory", engine.config.DeployDir,
		"--project-name", engine.config.ProjectName,
		"--file", engine.config.BaseCompose,
		"--file", engine.config.XboardCompose,
		"config", "--services",
	)
	if err != nil {
		return fmt.Errorf("validate Compose deployment: %w", err)
	}
	services := make(map[string]struct{})
	for _, service := range strings.Fields(string(output)) {
		services[service] = struct{}{}
	}
	if _, ok := services[ManagedService]; !ok {
		return fmt.Errorf("standard Compose service %s was not found", ManagedService)
	}
	for _, unsupported := range []string{"remnawave-rest-api", "remnawave-scheduler", "remnawave-processor"} {
		if _, ok := services[unsupported]; ok {
			return fmt.Errorf("advanced Compose layout is not supported by updater protocol 1")
		}
	}
	return nil
}

func (engine *DockerEngine) Pull(ctx context.Context, exactRef string) (ImageInfo, error) {
	if err := validateDeployRef(exactRef); err != nil || !strings.HasPrefix(exactRef, ImageRepository+"@") {
		return ImageInfo{}, fmt.Errorf("refuse to pull an unapproved image reference")
	}
	if _, err := engine.run(ctx, "pull", exactRef); err != nil {
		return ImageInfo{}, fmt.Errorf("pull target image: %w", err)
	}
	image, err := engine.inspectImage(ctx, exactRef)
	if err != nil {
		return ImageInfo{}, err
	}
	image.ConfiguredAs = exactRef
	image.Digest = digestFromConfiguredRef(exactRef)
	return image, nil
}

func (engine *DockerEngine) Preserve(ctx context.Context, current ImageInfo, operationID string) (string, error) {
	if current.ImageID == "" || !isOperationID(operationID) {
		return "", fmt.Errorf("cannot preserve an invalid image")
	}
	rollbackRef := "xboard-updater.local/backend:rollback-" + operationID
	if _, err := engine.run(ctx, "tag", current.ImageID, rollbackRef); err != nil {
		return "", fmt.Errorf("preserve rollback image: %w", err)
	}
	return rollbackRef, nil
}

func (engine *DockerEngine) DatabaseFingerprintForContainer(ctx context.Context, container string) (string, error) {
	if container != ManagedContainer {
		return "", fmt.Errorf("refuse to inspect an unmanaged container")
	}
	root, err := os.MkdirTemp("", "xboard-current-db-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(root)
	if err := engine.copyDatabaseInputs(ctx, container, root); err != nil {
		return "", err
	}
	return databaseFingerprint(root)
}

func (engine *DockerEngine) DatabaseFingerprintForImage(ctx context.Context, imageRef, operationID string) (string, error) {
	if err := validateDeployRef(imageRef); err != nil || !isOperationID(operationID) {
		return "", fmt.Errorf("refuse to inspect an invalid target image")
	}
	container := "xboard-updater-inspect-" + operationID
	if _, err := engine.run(ctx, "create", "--name", container, "--entrypoint", "/bin/true", imageRef); err != nil {
		return "", fmt.Errorf("create target inspection container: %w", err)
	}
	defer func() {
		_, _ = engine.run(context.Background(), "rm", "--force", container)
	}()

	root, err := os.MkdirTemp("", "xboard-target-db-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(root)
	if err := engine.copyDatabaseInputs(ctx, container, root); err != nil {
		return "", err
	}
	return databaseFingerprint(root)
}

func (engine *DockerEngine) DatabaseIsCurrent(ctx context.Context, container string) error {
	if container != ManagedContainer {
		return fmt.Errorf("refuse to inspect an unmanaged container")
	}
	_, err := engine.run(ctx, "exec", "--workdir", "/opt/app", container,
		"/opt/app/node_modules/.bin/prisma", "migrate", "status", "--schema", "/opt/app/prisma/schema.prisma")
	if err != nil {
		return fmt.Errorf("database migration status is not clean: %w", err)
	}
	return nil
}

func (engine *DockerEngine) ComposeUp(ctx context.Context, overridePath string) error {
	cleanPath := filepath.Clean(overridePath)
	overrideName := filepath.Base(cleanPath)
	validOverrideName, _ := regexp.MatchString(`^operation-[a-f0-9]{32}\.yml$`, overrideName)
	if filepath.Dir(cleanPath) != engine.config.StateDir || !validOverrideName {
		return fmt.Errorf("refuse to use an updater override outside the state directory")
	}
	arguments := []string{
		"compose",
		"--project-directory", engine.config.DeployDir,
		"--project-name", engine.config.ProjectName,
		"--file", engine.config.BaseCompose,
		"--file", engine.config.XboardCompose,
		"--file", cleanPath,
		"up", "--detach", "--no-deps", "--force-recreate", "--pull", "never", ManagedService,
	}
	if _, err := engine.run(ctx, arguments...); err != nil {
		return fmt.Errorf("recreate managed service: %w", err)
	}
	return nil
}

func (engine *DockerEngine) WaitHealthy(ctx context.Context, expectedRef string) error {
	if err := validateDeployRef(expectedRef); err != nil {
		return err
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		container, err := engine.inspectContainer(ctx)
		if err == nil {
			matches := container.Config.Image == expectedRef
			healthy := container.State.Health != nil && container.State.Health.Status == "healthy"
			if matches && healthy {
				if err := engine.probeManagedContainer(ctx); err == nil {
					select {
					case <-time.After(3 * time.Second):
						if err := engine.probeManagedContainer(ctx); err == nil {
							return nil
						}
					case <-ctx.Done():
						return ctx.Err()
					}
				}
			}
			if container.State.Status == "exited" || container.State.Status == "dead" {
				return fmt.Errorf("managed container stopped before becoming healthy")
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("managed container did not become healthy: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func (engine *DockerEngine) inspectContainer(ctx context.Context) (dockerContainerInspect, error) {
	const safeFormat = "{{.Image}}|{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}"
	output, err := engine.run(ctx, "inspect", "--type", "container", "--format", safeFormat, ManagedContainer)
	if err != nil {
		return dockerContainerInspect{}, err
	}
	parts := strings.SplitN(strings.TrimSpace(string(output)), "|", 4)
	if len(parts) != 4 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return dockerContainerInspect{}, fmt.Errorf("decode managed container inspection")
	}
	container := dockerContainerInspect{Image: parts[0]}
	container.Config.Image = parts[1]
	container.State.Status = parts[2]
	if parts[3] != "" {
		container.State.Health = &struct{ Status string }{Status: parts[3]}
	}
	return container, nil
}

func (engine *DockerEngine) inspectImage(ctx context.Context, reference string) (ImageInfo, error) {
	output, err := engine.run(ctx, "image", "inspect", reference)
	if err != nil {
		return ImageInfo{}, fmt.Errorf("inspect image: %w", err)
	}
	var images []dockerImageInspect
	if err := json.Unmarshal(output, &images); err != nil || len(images) != 1 {
		return ImageInfo{}, fmt.Errorf("decode image inspection")
	}
	inspected := images[0]
	digest := digestFromRefs(inspected.RepoDigests)
	version := inspected.Config.Labels["org.opencontainers.image.version"]
	if version == "" {
		version = envValue(inspected.Config.Env, "__RW_METADATA_VERSION")
	}
	return ImageInfo{
		ImageID: inspected.ID,
		Digest:  digest,
		Version: version,
		Labels:  inspected.Config.Labels,
	}, nil
}

func (engine *DockerEngine) copyDatabaseInputs(ctx context.Context, container, root string) error {
	if err := os.MkdirAll(filepath.Join(root, "migrations"), 0o700); err != nil {
		return err
	}
	if _, err := engine.run(ctx, "cp", container+":/opt/app/prisma/schema.prisma", filepath.Join(root, "schema.prisma")); err != nil {
		return fmt.Errorf("copy Prisma schema: %w", err)
	}
	if _, err := engine.run(ctx, "cp", container+":/opt/app/prisma/migrations/.", filepath.Join(root, "migrations")); err != nil {
		return fmt.Errorf("copy Prisma migrations: %w", err)
	}
	if _, err := engine.run(ctx, "cp", container+":/opt/app/dist/seed.js", filepath.Join(root, "seed.js")); err != nil {
		return fmt.Errorf("copy compiled database seed: %w", err)
	}
	if _, err := engine.run(ctx, "cp", container+":/opt/app/docker-entrypoint.sh", filepath.Join(root, "docker-entrypoint.sh")); err != nil {
		return fmt.Errorf("copy database bootstrap entrypoint: %w", err)
	}
	return nil
}

func (engine *DockerEngine) probeManagedContainer(ctx context.Context) error {
	output, err := engine.run(ctx, "inspect", "--format", "{{json .Config.Env}}", ManagedContainer)
	if err != nil {
		return fmt.Errorf("inspect managed container ports: %w", err)
	}
	var environment []string
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &environment); err != nil {
		return fmt.Errorf("decode managed container environment: %w", err)
	}
	appPort, err := containerPort(environment, "APP_PORT", 3000)
	if err != nil {
		return err
	}
	metricsPort, err := containerPort(environment, "METRICS_PORT", 3001)
	if err != nil {
		return err
	}
	for _, endpoint := range []string{
		fmt.Sprintf("http://127.0.0.1:%d/health", metricsPort),
		fmt.Sprintf("http://127.0.0.1:%d/", appPort),
	} {
		if _, err := engine.run(ctx, "exec", ManagedContainer, "curl", "--fail", "--silent", "--show-error", "--output", "/dev/null", "--max-time", "5", endpoint); err != nil {
			return err
		}
	}
	return nil
}

func containerPort(environment []string, name string, fallback int) (int, error) {
	raw := envValue(environment, name)
	if raw == "" {
		return fallback, nil
	}
	port, err := strconv.Atoi(raw)
	if err != nil || port < 1 || port > 65_535 {
		return 0, fmt.Errorf("managed container %s must be an integer between 1 and 65535", name)
	}
	return port, nil
}

func (engine *DockerEngine) run(ctx context.Context, arguments ...string) ([]byte, error) {
	commandContext, cancel := context.WithTimeout(ctx, engine.config.CommandTimeout)
	defer cancel()
	return engine.runner.Run(commandContext, "docker", arguments...)
}

func digestFromRefs(references []string) string {
	prefix := ImageRepository + "@"
	for _, reference := range references {
		if strings.HasPrefix(reference, prefix) {
			digest := strings.TrimPrefix(reference, prefix)
			if digestPattern.MatchString(digest) {
				return digest
			}
		}
	}
	return ""
}

func digestFromConfiguredRef(reference string) string {
	prefix := ImageRepository + "@"
	if !strings.HasPrefix(reference, prefix) {
		return ""
	}
	digest := strings.TrimPrefix(reference, prefix)
	if digestPattern.MatchString(digest) {
		return digest
	}
	return ""
}

func envValue(values []string, name string) string {
	prefix := name + "="
	for _, value := range values {
		if strings.HasPrefix(value, prefix) {
			return strings.TrimPrefix(value, prefix)
		}
	}
	return ""
}
