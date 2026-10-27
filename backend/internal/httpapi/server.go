// Package httpapi exposes the /api endpoints.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/languages"
	"github.com/Dewarrum/pocket-tolk/backend/internal/stt"
	"github.com/Dewarrum/pocket-tolk/backend/internal/translate"
)

type server struct {
	cfg       config.Config
	stt       *stt.Client
	translate *translate.Client
	log       *slog.Logger
}

// New returns the API handler: logging, then CORS, then auth, then routes.
func New(cfg config.Config, sttClient *stt.Client, translateClient *translate.Client, log *slog.Logger) http.Handler {
	s := &server{cfg: cfg, stt: sttClient, translate: translateClient, log: log}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/languages", s.languages)
	mux.HandleFunc("POST /api/transcribe", s.transcribe)
	mux.HandleFunc("POST /api/translate", s.translateText)
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

// maxTextRunes caps the text of one turn, and each text in its history.
const maxTextRunes = 4000

// maxTranslateBody leaves room for the text and a long history.
const maxTranslateBody = 1 << 20

type translateRequest struct {
	Languages []string         `json:"languages"`
	Text      string           `json:"text"`
	History   []translate.Turn `json:"history"`
}

func (s *server) translateText(w http.ResponseWriter, r *http.Request) {
	var in translateRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxTranslateBody)).Decode(&in); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			writeError(w, &apiError{http.StatusRequestEntityTooLarge, "too_large", "the request is larger than the limit"})
			return
		}
		writeError(w, badRequest("expected a JSON body"))
		return
	}
	if len(in.Languages) != 2 {
		writeError(w, badRequest("languages must be two codes"))
		return
	}
	langs, apiErr := languagePair(in.Languages)
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if apiErr := checkText("text", in.Text); apiErr != nil {
		writeError(w, apiErr)
		return
	}
	codes := []string{langs[0].Code, langs[1].Code}
	for i, h := range in.History {
		field := fmt.Sprintf("history[%d]", i)
		switch {
		case !slices.Contains(codes, h.SourceLang) && h.SourceLang != translate.Other:
			apiErr = badRequest(field + ".sourceLang must be a session language or other")
		case !slices.Contains(codes, h.TargetLang):
			apiErr = badRequest(field + ".targetLang must be a session language")
		default:
			if apiErr = checkText(field+".source", h.Source); apiErr == nil {
				apiErr = checkText(field+".translation", h.Translation)
			}
		}
		if apiErr != nil {
			writeError(w, apiErr)
			return
		}
	}

	res, err := s.translate.Translate(r.Context(), translate.Request{Languages: langs, Text: in.Text, History: in.History})
	if err != nil {
		if pe, ok := errors.AsType[*translate.ProviderError](err); ok {
			writeError(w, &apiError{http.StatusBadGateway, "provider_error", pe.Error()})
			return
		}
		writeError(w, &apiError{http.StatusInternalServerError, "internal_error", "translation failed"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"detectedLang": res.DetectedLang,
		"targetLang":   res.TargetLang,
		"translation":  res.Translation,
		"confident":    res.Confident,
		"model":        res.Model,
		"latencyMs":    res.Latency.Milliseconds(),
		"usage":        res.Usage,
	})
}

func checkText(field, text string) *apiError {
	switch {
	case strings.TrimSpace(text) == "":
		return badRequest(field + " is empty")
	case utf8.RuneCountInString(text) > maxTextRunes:
		return badRequest(fmt.Sprintf("%s is longer than %d characters", field, maxTextRunes))
	}
	return nil
}

func parseLanguages(raw string) ([2]languages.Language, *apiError) {
	codes := strings.Split(raw, ",")
	if len(codes) != 2 {
		return [2]languages.Language{}, badRequest("languages must be two comma-separated codes")
	}
	return languagePair(codes)
}

// languagePair looks up two distinct supported codes.
func languagePair(codes []string) ([2]languages.Language, *apiError) {
	var out [2]languages.Language
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
