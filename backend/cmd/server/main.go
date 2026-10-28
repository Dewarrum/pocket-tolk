package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/httpapi"
	"github.com/Dewarrum/pocket-tolk/backend/internal/stt"
	"github.com/Dewarrum/pocket-tolk/backend/internal/translate"
	"github.com/Dewarrum/pocket-tolk/backend/internal/tts"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pocket-tolk:", err)
		os.Exit(1)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: httpapi.New(cfg,
			stt.New(cfg.STT, cfg.ProviderTimeout, log),
			translate.New(cfg.Translate, cfg.ProviderTimeout, log),
			tts.New(cfg.TTS, cfg.ProviderTimeout, log),
			log),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		// A translation can take two provider calls plus a fallback for each.
		WriteTimeout: 4*cfg.ProviderTimeout + 2*time.Minute,
		IdleTimeout:  2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	log.Info("listening", "port", cfg.Port, "sttModel", cfg.STT.Model,
		"translateModel", cfg.Translate.Model, "translateFallbackModel", cfg.Translate.FallbackModel,
		"translateReasoningEffort", cfg.Translate.ReasoningEffort, "ttsModel", cfg.TTS.Model)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "error", err.Error())
		os.Exit(1)
	}
	<-drained
}
