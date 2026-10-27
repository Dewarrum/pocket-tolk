// Package httpapi exposes the /api endpoints.
package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/languages"
	"github.com/Dewarrum/pocket-tolk/backend/internal/stt"
)

type server struct {
	cfg config.Config
	stt *stt.Client
	log *slog.Logger
}

// New returns the API handler: logging, then CORS, then auth, then routes.
func New(cfg config.Config, sttClient *stt.Client, log *slog.Logger) http.Handler {
	s := &server{cfg: cfg, stt: sttClient, log: log}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/languages", s.languages)
	mux.HandleFunc("POST /api/transcribe", s.transcribe)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, &apiError{http.StatusNotFound, "not_found", "no such endpoint"})
	})

	return logRequests(log, cors(cfg.AllowedOrigin, requireToken(cfg.AppToken, mux)))
}

func (s *server) languages(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, languages.All)
}

// formOverhead covers the non-file fields and multipart framing of an upload.
const formOverhead = 1 << 20

func (s *server) transcribe(w http.ResponseWriter, r *http.Request) {
	tooLarge := &apiError{http.StatusRequestEntityTooLarge, "too_large",
		"the recording is larger than the upload limit"}

	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes+formOverhead)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			writeError(w, tooLarge)
			return
		}
		writeError(w, badRequest("expected a multipart form"))
		return
	}
	defer r.MultipartForm.RemoveAll()

	langs, apiErr := parseLanguages(r.FormValue("languages"))
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	file, header, err := r.FormFile("audio")
	if err != nil {
		writeError(w, badRequest("the audio field is required"))
		return
	}
	defer file.Close()
	switch {
	case header.Size > s.cfg.MaxUploadBytes:
		writeError(w, tooLarge)
		return
	case header.Size == 0:
		writeError(w, badRequest("the recording is empty"))
		return
	}

	res, err := s.stt.Transcribe(r.Context(), stt.Audio{
		Body:        file,
		Size:        header.Size,
		Filename:    header.Filename,
		ContentType: header.Header.Get("Content-Type"),
	}, stt.Prompt(langs, r.FormValue("hint")))
	if err != nil {
		if pe, ok := errors.AsType[*stt.ProviderError](err); ok {
			writeError(w, &apiError{http.StatusBadGateway, "provider_error", pe.Error()})
			return
		}
		writeError(w, &apiError{http.StatusInternalServerError, "internal_error", "transcription failed"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"text":      res.Text,
		"model":     res.Model,
		"latencyMs": res.Latency.Milliseconds(),
	})
}

func parseLanguages(raw string) ([2]languages.Language, *apiError) {
	var out [2]languages.Language
	codes := strings.Split(raw, ",")
	if len(codes) != 2 {
		return out, badRequest("languages must be two comma-separated codes")
	}
	for i, code := range codes {
		code = strings.TrimSpace(code)
		l, ok := languages.Lookup(code)
		if !ok {
			return out, &apiError{http.StatusBadRequest, "unsupported_language", "unsupported language code: " + code}
		}
		out[i] = l
	}
	if out[0].Code == out[1].Code {
		return out, badRequest("languages must be two different codes")
	}
	return out, nil
}
