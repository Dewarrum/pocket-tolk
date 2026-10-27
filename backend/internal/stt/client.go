// Package stt is a client for an OpenAI-shaped transcription API
// (POST {base}/audio/transcriptions), such as Groq or OpenAI.
package stt

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path"
	"strings"
	"time"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/languages"
)

// maxHintRunes keeps the prompt inside Whisper's 224-token prompt window.
// The tail of the hint is kept because it is what the new clip continues.
const maxHintRunes = 200

type Client struct {
	cfg     config.STT
	timeout time.Duration
	http    *http.Client
	log     *slog.Logger
}

func New(cfg config.STT, timeout time.Duration, log *slog.Logger) *Client {
	return &Client{cfg: cfg, timeout: timeout, http: &http.Client{}, log: log}
}

type Audio struct {
	Body        io.Reader
	Size        int64
	Filename    string
	ContentType string
}

type Result struct {
	Text    string
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

func (e *ProviderError) Error() string { return "transcription provider " + e.reason }

// Prompt tells the recogniser which two languages to expect and, for the
// Add more case, the text the new clip continues.
func Prompt(langs [2]languages.Language, hint string) string {
	p := fmt.Sprintf("The speaker uses %s or %s.", langs[0].Name, langs[1].Name)
	hint = strings.TrimSpace(hint)
	if r := []rune(hint); len(r) > maxHintRunes {
		hint = strings.TrimSpace(string(r[len(r)-maxHintRunes:]))
	}
	if hint != "" {
		p += " " + hint
	}
	return p
}

func (c *Client) Transcribe(ctx context.Context, audio Audio, prompt string) (Result, error) {
	body, contentType, err := c.encode(audio, prompt)
	if err != nil {
		return Result{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/audio/transcriptions", body)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", contentType)

	start := time.Now()
	text, status, err := c.do(req)
	latency := time.Since(start)

	attrs := []any{"stage", "stt", "model", c.cfg.Model, "latencyMs", latency.Milliseconds(), "status", status, "bytesIn", audio.Size}
	if err != nil {
		c.log.Warn("provider call", append(attrs, "error", err.Error())...)
		return Result{}, err
	}
	c.log.Info("provider call", attrs...)
	return Result{Text: strings.TrimSpace(text), Model: c.cfg.Model, Latency: latency}, nil
}

func (c *Client) do(req *http.Request) (text string, status int, err error) {
	resp, err := c.http.Do(req)
	if err != nil {
		switch {
		case errors.Is(req.Context().Err(), context.DeadlineExceeded):
			return "", 0, &ProviderError{Timeout: true, reason: fmt.Sprintf("timed out after %s", c.timeout)}
		case req.Context().Err() != nil:
			return "", 0, req.Context().Err() // the caller went away
		default:
			return "", 0, &ProviderError{reason: "is unreachable"}
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return "", resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: fmt.Sprintf("returned HTTP %d", resp.StatusCode)}
	}
	var out struct {
		Text *string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil || out.Text == nil {
		return "", resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: "sent an unreadable response"}
	}
	return *out.Text, resp.StatusCode, nil
}

func (c *Client) encode(audio Audio, prompt string) (*bytes.Buffer, string, error) {
	var buf bytes.Buffer
	buf.Grow(int(audio.Size) + 1024)
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("model", c.cfg.Model)
	_ = mw.WriteField("response_format", "json")
	if prompt != "" {
		_ = mw.WriteField("prompt", prompt)
	}

	ct := audio.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, FileName(audio.Filename, ct)))
	h.Set("Content-Type", ct)
	part, err := mw.CreatePart(h)
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, audio.Body); err != nil {
		return nil, "", fmt.Errorf("read upload: %w", err)
	}
	if err := mw.Close(); err != nil {
		return nil, "", err
	}
	return &buf, mw.FormDataContentType(), nil
}

// The provider infers the container from the file extension.
var extByType = map[string]string{
	"audio/webm":  ".webm",
	"audio/mp4":   ".mp4",
	"audio/x-m4a": ".m4a",
	"audio/aac":   ".m4a",
	"audio/mpeg":  ".mp3",
	"audio/ogg":   ".ogg",
	"audio/wav":   ".wav",
	"audio/wave":  ".wav",
	"audio/x-wav": ".wav",
	"audio/flac":  ".flac",
}

var knownExt = map[string]bool{
	".flac": true, ".m4a": true, ".mp3": true, ".mp4": true, ".mpeg": true,
	".mpga": true, ".ogg": true, ".opus": true, ".wav": true, ".webm": true,
}

// FileName returns a safe upload name whose extension matches the audio
// container, taken from the client's file name or else its content type.
func FileName(clientName, contentType string) string {
	if ext := strings.ToLower(path.Ext(clientName)); knownExt[ext] {
		return "audio" + ext
	}
	base, _, _ := strings.Cut(contentType, ";")
	return "audio" + extByType[strings.ToLower(strings.TrimSpace(base))]
}
