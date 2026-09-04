package updater

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRegistryResolverUsesFixedScopeAndReturnsDigest(t *testing.T) {
	digest := "sha256:" + strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/token":
			if request.URL.Query().Get("service") != "ghcr.io" || request.URL.Query().Get("scope") != registryScope {
				t.Errorf("unexpected token query: %s", request.URL.RawQuery)
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"token":"0123456789abcdef0123456789abcdef"}`))
		case "/v2/fengyuchen1314/backend/manifests/xboard-dev":
			if request.Header.Get("Authorization") != "Bearer 0123456789abcdef0123456789abcdef" {
				t.Errorf("unexpected authorization header")
			}
			response.Header().Set("Docker-Content-Digest", digest)
			_, _ = response.Write([]byte(`{"schemaVersion":2}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	resolver := newRegistryResolver(server.URL, server.URL+"/token")
	resolved, err := resolver.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if resolved != digest {
		t.Fatalf("digest = %q, want %q", resolved, digest)
	}
}

func TestRegistryResolverRejectsInvalidDigestAndRedirect(t *testing.T) {
	for _, test := range []struct {
		name     string
		manifest func(http.ResponseWriter, *http.Request)
	}{
		{
			name: "invalid digest",
			manifest: func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Docker-Content-Digest", "sha256:not-a-digest")
				_, _ = response.Write([]byte(`{}`))
			},
		},
		{
			name: "redirect",
			manifest: func(response http.ResponseWriter, request *http.Request) {
				http.Redirect(response, request, "https://example.invalid/manifest", http.StatusFound)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/token" {
					_, _ = response.Write([]byte(`{"token":"0123456789abcdef0123456789abcdef"}`))
					return
				}
				test.manifest(response, request)
			}))
			defer server.Close()
			resolver := newRegistryResolver(server.URL, server.URL+"/token")
			if _, err := resolver.Resolve(context.Background()); err == nil {
				t.Fatal("expected resolver failure")
			}
		})
	}
}

func TestRegistryResolverCapsManifestBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/token" {
			_, _ = response.Write([]byte(`{"token":"0123456789abcdef0123456789abcdef"}`))
			return
		}
		response.Header().Set("Docker-Content-Digest", "sha256:"+strings.Repeat("b", 64))
		_, _ = fmt.Fprint(response, strings.Repeat("x", maxRegistryResponse+1))
	}))
	defer server.Close()
	resolver := newRegistryResolver(server.URL, server.URL+"/token")
	if _, err := resolver.Resolve(context.Background()); err == nil {
		t.Fatal("expected oversized manifest failure")
	}
}
