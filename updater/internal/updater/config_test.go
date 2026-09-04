package updater

import "testing"

func TestLoadConfigRestrictsSecretAndListenAddress(t *testing.T) {
	t.Setenv("UPDATER_SECRET", testSecret)
	t.Setenv("UPDATER_DEPLOY_DIR", t.TempDir())
	for _, address := range []string{":8080", "0.0.0.0:8080", "127.0.0.1:8080"} {
		t.Setenv("UPDATER_LISTEN_ADDRESS", address)
		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("approved address %q was rejected: %v", address, err)
		}
		if config.ListenAddress != address {
			t.Fatalf("listen address = %q, want %q", config.ListenAddress, address)
		}
	}

	t.Setenv("UPDATER_LISTEN_ADDRESS", ":9090")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected non-8080 listen address rejection")
	}
	t.Setenv("UPDATER_LISTEN_ADDRESS", ":8080")
	t.Setenv("UPDATER_SECRET", "too-short")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected short secret rejection")
	}
}
