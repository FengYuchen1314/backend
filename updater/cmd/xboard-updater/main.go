package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/FengYuchen1314/backend/updater/internal/updater"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 2 || (len(os.Args) == 2 && os.Args[1] != "serve") {
		fmt.Fprintln(os.Stderr, "unsupported command")
		os.Exit(2)
	}

	config, err := updater.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}
	store := updater.NewStateStore(config.StateDir)
	if err := store.Ensure(); err != nil {
		log.Fatal(err)
	}
	engine := updater.NewDockerEngine(config, updater.ExecRunner{})
	manager := updater.NewManager(config, store, engine, updater.NewRegistryResolver())
	recoveryContext, recoveryCancel := context.WithTimeout(context.Background(), config.CommandTimeout+config.HealthTimeout)
	if err := manager.Recover(recoveryContext); err != nil {
		recoveryCancel()
		log.Print("interrupted updater operation could not be recovered; manual recovery is required")
		os.Exit(1)
	}
	recoveryCancel()

	server := &http.Server{
		Addr:              config.ListenAddress,
		Handler:           updater.NewServer(config.Secret, manager).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownContext.Done()
		context, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = server.Shutdown(context)
	}()

	log.Printf("xboard updater listening on %s", config.ListenAddress)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func healthcheck() error {
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://127.0.0.1:8080/healthz")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("updater health endpoint returned HTTP %d", response.StatusCode)
	}
	return nil
}
