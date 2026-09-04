package updater

import (
	"context"
	"time"
)

const (
	Channel               = "xboard-dev"
	TrackedImage          = "ghcr.io/fengyuchen1314/backend:xboard-dev"
	ImageRepository       = "ghcr.io/fengyuchen1314/backend"
	ExpectedSource        = "https://github.com/FengYuchen1314/backend"
	ManagedService        = "remnawave"
	ManagedContainer      = "remnawave"
	UpdaterProtocolLabel  = "io.xboard.updater.protocol"
	UpdaterProtocol       = "1"
	SkipDBBootstrapEnv    = "XBOARD_SKIP_DB_BOOTSTRAP"
	StatusIdle            = "IDLE"
	StatusUpdating        = "UPDATING"
	StatusSucceeded       = "SUCCEEDED"
	StatusFailed          = "FAILED"
	TriggerQueued         = "QUEUED"
	TriggerUpdating       = "UPDATING"
	TriggerRejected       = "REJECTED"
	maxPublicErrorLength  = 2_000
	maxVersionLength      = 100
	defaultHealthTimeout  = 3 * time.Minute
	defaultCommandTimeout = 10 * time.Minute
)

type Config struct {
	ListenAddress  string
	Secret         string
	DeployDir      string
	StateDir       string
	BaseCompose    string
	XboardCompose  string
	ProjectName    string
	HealthTimeout  time.Duration
	CommandTimeout time.Duration
}

type ImageInfo struct {
	ImageID      string
	ConfiguredAs string
	Digest       string
	Version      string
	Labels       map[string]string
}

type StatusResponse struct {
	Channel         string     `json:"channel"`
	State           string     `json:"state"`
	CurrentVersion  *string    `json:"currentVersion"`
	TargetVersion   *string    `json:"targetVersion"`
	UpdateAvailable bool       `json:"updateAvailable"`
	LastError       *string    `json:"lastError"`
	UpdatedAt       *time.Time `json:"updatedAt"`
}

type TriggerResponse struct {
	Accepted    bool    `json:"accepted"`
	OperationID *string `json:"operationId"`
	State       string  `json:"state"`
	Message     *string `json:"message"`
}

type Journal struct {
	Channel           string    `json:"channel"`
	State             string    `json:"state"`
	Phase             string    `json:"phase"`
	OperationID       string    `json:"operationId"`
	CurrentVersion    string    `json:"currentVersion,omitempty"`
	TargetVersion     string    `json:"targetVersion,omitempty"`
	PreviousDigest    string    `json:"previousDigest,omitempty"`
	PreviousRef       string    `json:"previousRef,omitempty"`
	TargetDigest      string    `json:"targetDigest,omitempty"`
	TargetRef         string    `json:"targetRef,omitempty"`
	LastError         string    `json:"lastError,omitempty"`
	RollbackSucceeded bool      `json:"rollbackSucceeded,omitempty"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type Engine interface {
	Current(context.Context) (ImageInfo, error)
	ValidateLayout(context.Context) error
	Pull(context.Context, string) (ImageInfo, error)
	Preserve(context.Context, ImageInfo, string) (string, error)
	DatabaseFingerprintForContainer(context.Context, string) (string, error)
	DatabaseFingerprintForImage(context.Context, string, string) (string, error)
	DatabaseIsCurrent(context.Context, string) error
	ComposeUp(context.Context, string) error
	WaitHealthy(context.Context, string) error
}

type DigestResolver interface {
	Resolve(context.Context) (string, error)
}
