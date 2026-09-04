package updater

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func LoadConfig() (Config, error) {
	secret := os.Getenv("UPDATER_SECRET")
	if err := validateSecret(secret); err != nil {
		return Config{}, err
	}

	deployDir := envOrDefault("UPDATER_DEPLOY_DIR", "/opt/remnawave")
	if !filepath.IsAbs(deployDir) || filepath.Clean(deployDir) != deployDir {
		return Config{}, fmt.Errorf("UPDATER_DEPLOY_DIR must be a clean absolute path")
	}
	filesystemRoot := filepath.VolumeName(deployDir) + string(filepath.Separator)
	if deployDir == filesystemRoot {
		return Config{}, fmt.Errorf("UPDATER_DEPLOY_DIR must not be the filesystem root")
	}

	stateDir := filepath.Join(deployDir, ".xboard")
	healthTimeout, err := durationEnv("UPDATER_HEALTH_TIMEOUT_SECONDS", defaultHealthTimeout, 30*time.Second, 10*time.Minute)
	if err != nil {
		return Config{}, err
	}
	commandTimeout, err := durationEnv("UPDATER_COMMAND_TIMEOUT_SECONDS", defaultCommandTimeout, time.Minute, 30*time.Minute)
	if err != nil {
		return Config{}, err
	}

	listenAddress := envOrDefault("UPDATER_LISTEN_ADDRESS", ":8080")
	if listenAddress != ":8080" && listenAddress != "0.0.0.0:8080" && listenAddress != "127.0.0.1:8080" {
		return Config{}, fmt.Errorf("UPDATER_LISTEN_ADDRESS must listen on port 8080 using an approved local bind address")
	}

	return Config{
		ListenAddress:  listenAddress,
		Secret:         secret,
		DeployDir:      deployDir,
		StateDir:       stateDir,
		BaseCompose:    filepath.Join(deployDir, "docker-compose-prod.yml"),
		XboardCompose:  filepath.Join(deployDir, "docker-compose-xboard.yml"),
		ProjectName:    "remnawave",
		HealthTimeout:  healthTimeout,
		CommandTimeout: commandTimeout,
	}, nil
}

func validateSecret(secret string) error {
	if len(secret) < 32 || len(secret) > 512 {
		return fmt.Errorf("UPDATER_SECRET must contain between 32 and 512 characters")
	}
	for _, value := range []byte(secret) {
		if value < 0x21 || value > 0x7e {
			return fmt.Errorf("UPDATER_SECRET must contain printable ASCII characters without spaces")
		}
	}
	return nil
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationEnv(name string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer number of seconds", name)
	}
	value := time.Duration(seconds) * time.Second
	if value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d seconds", name, int(minimum.Seconds()), int(maximum.Seconds()))
	}
	return value, nil
}
