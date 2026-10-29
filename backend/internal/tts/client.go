// Package tts is a client for Cartesia's text-to-speech bytes endpoint
// (POST {base}/tts/bytes), which answers with the whole clip as mp3.
package tts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/languages"
)

// APIVersion is the Cartesia-Version header the request shape follows.
const APIVersion = "2026-08-14"

// maxAudioBytes bounds the clip read into memory. 1000 characters of speech
// at 64 kbps is well under 1 MB.
const maxAudioBytes = 8 << 20

type Client struct {
	cfg     config.TTS
	timeout time.Duration
	http    *http.Client
	log     *slog.Logger
}

func New(cfg config.TTS, timeout time.Duration, log *slog.Logger) *Client {
	return &Client{cfg: cfg, timeout: timeout, http: &http.Client{}, log: log}
}

type Result struct {
	Audio   []byte // mp3
	Model   string
	Latency time.Duration
}

// ProviderError means the provider failed or did not answer in time.
// Its message is safe to show to the caller: it never contains provider
// response bodies or credentials.
type ProviderError struct {
	Status  int // HTTP status from the provider, 0 when there was no response
	Timeout bool
	reason  string
}

func (e *ProviderError) Error() string { return "speech provider " + e.reason }

type request struct {
	ModelID      string       `json:"model_id"`
	Transcript   string       `json:"transcript"`
	Voice        voice        `json:"voice"`
	Language     string       `json:"language"`
	OutputFormat outputFormat `json:"output_format"`
}

type voice struct {
	ID string `json:"id"`
}

type outputFormat struct {
	Container  string `json:"container"`
	SampleRate int    `json:"sample_rate"`
	BitRate    int    `json:"bit_rate"`
}

// Speak renders text in lang's voice. The caller checks that lang has one.
func (c *Client) Speak(ctx context.Context, lang languages.Language, text string) (Result, error) {
	body, err := json.Marshal(request{
		ModelID:      c.cfg.Model,
		Transcript:   text,
		Voice:        voice{ID: lang.Voice},
		Language:     Language(lang.Code),
		OutputFormat: outputFormat{Container: "mp3", SampleRate: 44100, BitRate: 64000},
	})
	if err != nil {
		return Result{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/tts/bytes", bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Cartesia-Version", APIVersion)
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	audio, status, err := c.do(req)
	latency := time.Since(start)

	attrs := []any{"stage", "tts", "model", c.cfg.Model, "latencyMs", latency.Milliseconds(), "status", status,
		"chars", utf8.RuneCountInString(text), "bytesOut", len(audio)}
	if err != nil {
		c.log.Warn("provider call", append(attrs, "error", err.Error())...)
		return Result{}, err
	}
	c.log.Info("provider call", attrs...)
	return Result{Audio: audio, Model: c.cfg.Model, Latency: latency}, nil
}

func (c *Client) do(req *http.Request) (audio []byte, status int, err error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, c.transportError(req)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return nil, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: fmt.Sprintf("returned HTTP %d", resp.StatusCode)}
	}
	audio, err = io.ReadAll(io.LimitReader(resp.Body, maxAudioBytes+1))
	switch {
	case err != nil && req.Context().Err() != nil:
		return nil, resp.StatusCode, c.transportError(req)
	case err != nil:
		return nil, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: "broke off the audio"}
	case len(audio) == 0:
		return nil, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: "sent no audio"}
	case len(audio) > maxAudioBytes:
		return nil, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: "sent more audio than expected"}
	}
	return audio, resp.StatusCode, nil
}

func (c *Client) transportError(req *http.Request) error {
	switch {
	case errors.Is(req.Context().Err(), context.DeadlineExceeded):
		return &ProviderError{Timeout: true, reason: fmt.Sprintf("timed out after %s", c.timeout)}
	case req.Context().Err() != nil:
		return req.Context().Err() // the caller went away
	default:
		return &ProviderError{reason: "is unreachable"}
	}
}

// Language is Cartesia's code for a supported language: the base subtag,
// with Norwegian Bokmål and Filipino under the codes Cartesia uses.
func Language(code string) string {
	base, _, _ := strings.Cut(code, "-")
	switch base {
	case "nb":
		return "no"
	case "fil":
		return "tl"
	}
	return base
}
