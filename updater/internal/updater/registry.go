package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	defaultRegistryBase = "https://ghcr.io"
	defaultTokenURL     = "https://ghcr.io/token"
	registryRepository  = "fengyuchen1314/backend"
	registryScope       = "repository:fengyuchen1314/backend:pull"
	maxRegistryResponse = 1 << 20
)

var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type RegistryResolver struct {
	client       *http.Client
	registryBase string
	tokenURL     string
}

func NewRegistryResolver() *RegistryResolver {
	return newRegistryResolver(defaultRegistryBase, defaultTokenURL)
}

func newRegistryResolver(registryBase, tokenURL string) *RegistryResolver {
	return &RegistryResolver{
		client: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		registryBase: strings.TrimRight(registryBase, "/"),
		tokenURL:     tokenURL,
	}
}

func (resolver *RegistryResolver) Resolve(ctx context.Context) (string, error) {
	token, err := resolver.getToken(ctx)
	if err != nil {
		return "", err
	}
	manifestURL := fmt.Sprintf("%s/v2/%s/manifests/%s", resolver.registryBase, registryRepository, Channel)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return "", fmt.Errorf("build registry manifest request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", strings.Join([]string{
		"application/vnd.oci.image.index.v1+json",
		"application/vnd.docker.distribution.manifest.list.v2+json",
		"application/vnd.oci.image.manifest.v1+json",
		"application/vnd.docker.distribution.manifest.v2+json",
	}, ", "))

	response, err := resolver.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("request registry manifest: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4_096))
		return "", fmt.Errorf("registry manifest returned HTTP %d", response.StatusCode)
	}
	readBytes, err := io.Copy(io.Discard, io.LimitReader(response.Body, maxRegistryResponse+1))
	if err != nil {
		return "", fmt.Errorf("read registry manifest: %w", err)
	}
	if readBytes > maxRegistryResponse {
		return "", fmt.Errorf("registry manifest exceeded the size limit")
	}
	digest := strings.ToLower(strings.TrimSpace(response.Header.Get("Docker-Content-Digest")))
	if !digestPattern.MatchString(digest) {
		return "", fmt.Errorf("registry returned an invalid content digest")
	}
	return digest, nil
}

func (resolver *RegistryResolver) getToken(ctx context.Context) (string, error) {
	parsed, err := url.Parse(resolver.tokenURL)
	if err != nil {
		return "", fmt.Errorf("parse registry token URL: %w", err)
	}
	query := parsed.Query()
	query.Set("service", "ghcr.io")
	query.Set("scope", registryScope)
	parsed.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", fmt.Errorf("build registry token request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := resolver.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("request registry token: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry token endpoint returned HTTP %d", response.StatusCode)
	}

	tokenPayload, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil {
		return "", fmt.Errorf("read registry token: %w", err)
	}
	if len(tokenPayload) > 64*1024 {
		return "", fmt.Errorf("registry token response exceeded the size limit")
	}
	var payload struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(tokenPayload)))
	if err := decoder.Decode(&payload); err != nil {
		return "", fmt.Errorf("decode registry token: %w", err)
	}
	token := payload.Token
	if token == "" {
		token = payload.AccessToken
	}
	if len(token) < 16 || len(token) > 16_384 || strings.ContainsAny(token, "\r\n") {
		return "", fmt.Errorf("registry returned an invalid bearer token")
	}
	return token, nil
}

func exactImageRef(digest string) (string, error) {
	if !digestPattern.MatchString(digest) {
		return "", fmt.Errorf("invalid image digest")
	}
	return ImageRepository + "@" + digest, nil
}

func validateDeployRef(imageRef string) error {
	if strings.HasPrefix(imageRef, ImageRepository+"@") {
		if _, err := exactImageRef(strings.TrimPrefix(imageRef, ImageRepository+"@")); err != nil {
			return err
		}
		return nil
	}
	if matched, _ := regexp.MatchString(`^xboard-updater\.local/backend:rollback-[a-f0-9]{32}$`, imageRef); matched {
		return nil
	}
	return fmt.Errorf("image reference is outside the updater allowlist")
}

func shortDigestVersion(digest string) string {
	if !digestPattern.MatchString(digest) {
		return "unknown"
	}
	return Channel + "@" + digest[7:19]
}
