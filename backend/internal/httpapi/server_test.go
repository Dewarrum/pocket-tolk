package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/stt"
	"github.com/Dewarrum/pocket-tolk/backend/internal/translate"
)

const (
	appToken     = "test-token"
	sttKey       = "sk-secret-key"
	translateKey = "sk-or-secret-key"
	origin       = "https://app.example"
)

// newAPI returns the full handler wired to one fake provider that serves both
// the STT and the translation API. edit adjusts the config before wiring.
func newAPI(t *testing.T, provider http.HandlerFunc, edit ...func(*config.Config)) http.Handler {
	t.Helper()
	fake := httptest.NewServer(provider)
	t.Cleanup(fake.Close)
	cfg := config.Config{
		AppToken:        appToken,
		AllowedOrigin:   origin,
		ProviderTimeout: 5 * time.Second,
		MaxUploadBytes:  1 << 20,
		STT:             config.STT{BaseURL: fake.URL, APIKey: sttKey, Model: "whisper-test"},
		Translate: config.Translate{BaseURL: fake.URL, APIKey: translateKey,
			Model: "primary-test", FallbackModel: "fallback-test", ContextTurns: 2},
	}
	for _, e := range edit {
		e(&cfg)
	}
	log := slog.New(slog.DiscardHandler)
	return New(cfg, stt.New(cfg.STT, cfg.ProviderTimeout, log), translate.New(cfg.Translate, cfg.ProviderTimeout, log), log)
}

func send(h http.Handler, r *http.Request) (*httptest.ResponseRecorder, map[string]any) {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

func errorCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

func TestAuth(t *testing.T) {
	var seen Principal
	h := requireToken(appToken, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen, _ = PrincipalFrom(r.Context())
	}))

	for name, header := range map[string]string{
		"missing":      "",
		"wrong token":  "Bearer nope",
		"wrong scheme": "Basic " + appToken,
	} {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/languages", nil)
			r.Header.Set("Authorization", header)
			rec, body := send(h, r)
			if rec.Code != http.StatusUnauthorized || errorCode(body) != "unauthorized" {
				t.Fatalf("got %d %v, want 401 unauthorized", rec.Code, body)
			}
		})
	}

	r := httptest.NewRequest(http.MethodGet, "/api/languages", nil)
	r.Header.Set("Authorization", "Bearer "+appToken)
	if rec, _ := send(h, r); rec.Code != http.StatusOK || seen.ID == "" {
		t.Fatalf("valid token: got %d, principal %+v", rec.Code, seen)
	}
}

func TestPreflightIsAnsweredWithoutToken(t *testing.T) {
	r := httptest.NewRequest(http.MethodOptions, "/api/transcribe", nil)
	r.Header.Set("Origin", origin)
	r.Header.Set("Access-Control-Request-Method", "POST")
	rec, _ := send(newAPI(t, nil), r)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != origin {
		t.Fatalf("got %d, allow-origin %q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestLanguages(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/languages", nil)
	r.Header.Set("Authorization", "Bearer "+appToken)
	rec := httptest.NewRecorder()
	newAPI(t, nil).ServeHTTP(rec, r)

	var langs []map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &langs); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if len(langs) != 34 {
		t.Fatalf("got %d languages, want 34", len(langs))
	}
	want := map[string]string{"code": "ko", "name": "Korean", "nativeName": "한국어"}
	if got := langs[1]; len(got) != 3 || got["code"] != want["code"] || got["nativeName"] != want["nativeName"] {
		t.Fatalf("got %v, want %v and no voice", got, want)
	}
}

func transcribeRequest(t *testing.T, languages string, audio []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("languages", languages)
	_ = mw.WriteField("hint", "안녕하세요")
	fw, _ := mw.CreateFormFile("audio", "clip.webm")
	_, _ = fw.Write(audio)
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/transcribe", &buf)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r.Header.Set("Authorization", "Bearer "+appToken)
	return r
}

func TestTranscribe(t *testing.T) {
	t.Run("forwards the clip and prompt", func(t *testing.T) {
		h := newAPI(t, func(w http.ResponseWriter, r *http.Request) {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("provider got a bad form: %v", err)
			}
			file, fh, _ := r.FormFile("file")
			audio, _ := io.ReadAll(file)
			got := map[string]string{
				"path":            r.URL.Path,
				"auth":            r.Header.Get("Authorization"),
				"model":           r.FormValue("model"),
				"response_format": r.FormValue("response_format"),
				"prompt":          r.FormValue("prompt"),
				"filename":        fh.Filename,
				"audio":           string(audio),
			}
			want := map[string]string{
				"path":            "/audio/transcriptions",
				"auth":            "Bearer " + sttKey,
				"model":           "whisper-test",
				"response_format": "json",
				"prompt":          "The speaker uses Korean or Russian. 안녕하세요",
				"filename":        "audio.webm",
				"audio":           "fake-opus",
			}
			for k := range want {
				if got[k] != want[k] {
					t.Errorf("provider got %s=%q, want %q", k, got[k], want[k])
				}
			}
			io.WriteString(w, `{"text":" 다시 만나요 "}`)
		})

		rec, body := send(h, transcribeRequest(t, "ko,ru", []byte("fake-opus")))
		if rec.Code != http.StatusOK || body["text"] != "다시 만나요" || body["model"] != "whisper-test" {
			t.Fatalf("got %d %v", rec.Code, body)
		}
		if _, ok := body["latencyMs"].(float64); !ok {
			t.Fatalf("latencyMs missing: %v", body)
		}
	})

	t.Run("provider failure is a 502 without secrets", func(t *testing.T) {
		h := newAPI(t, func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":{"message":"boom for `+sttKey+`"}}`, http.StatusInternalServerError)
		})
		rec, body := send(h, transcribeRequest(t, "ko,ru", []byte("fake-opus")))
		if rec.Code != http.StatusBadGateway || errorCode(body) != "provider_error" {
			t.Fatalf("got %d %v, want 502 provider_error", rec.Code, body)
		}
		if strings.Contains(rec.Body.String(), sttKey) {
			t.Fatalf("response leaks the provider key: %s", rec.Body)
		}
	})

	rejected := []struct {
		name      string
		languages string
		size      int
		status    int
		code      string
	}{
		{"oversize upload", "ko,ru", 1<<20 + 1, http.StatusRequestEntityTooLarge, "too_large"},
		{"unknown language", "ko,xx", 10, http.StatusBadRequest, "unsupported_language"},
	}
	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			h := newAPI(t, func(w http.ResponseWriter, r *http.Request) {
				t.Error("provider must not be called")
			})
			rec, body := send(h, transcribeRequest(t, tc.languages, bytes.Repeat([]byte("a"), tc.size)))
			if rec.Code != tc.status || errorCode(body) != tc.code {
				t.Fatalf("got %d %v, want %d %s", rec.Code, body, tc.status, tc.code)
			}
		})
	}
}
