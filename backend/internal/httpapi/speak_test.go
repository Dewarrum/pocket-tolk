package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postSpeak(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/speak", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+appToken)
	return r
}

func TestSpeak(t *testing.T) {
	t.Run("returns the provider's mp3 in the language's voice", func(t *testing.T) {
		h := newAPI(t, func(w http.ResponseWriter, r *http.Request) {
			var got struct {
				ModelID      string            `json:"model_id"`
				Transcript   string            `json:"transcript"`
				Voice        map[string]string `json:"voice"`
				Language     string            `json:"language"`
				OutputFormat map[string]any    `json:"output_format"`
			}
			_ = json.NewDecoder(r.Body).Decode(&got)
			if r.URL.Path != "/tts/bytes" || r.Header.Get("Authorization") != "Bearer "+ttsKey ||
				r.Header.Get("Cartesia-Version") != "2026-08-14" || got.ModelID != "sonic-test" ||
				got.Transcript != "그녀는 어디에 있어요?" || got.Voice["id"] != "e1717dc3-b87b-4720-aa7f-b6db290e0609" ||
				got.Language != "ko" || got.OutputFormat["container"] != "mp3" {
				t.Errorf("provider got %s %+v", r.URL.Path, got)
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			io.WriteString(w, "ID3fake-mp3")
		})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, postSpeak(`{"lang":"ko","text":" 그녀는 어디에 있어요? "}`))
		if rec.Code != http.StatusOK || rec.Body.String() != "ID3fake-mp3" ||
			rec.Header().Get("Content-Type") != "audio/mpeg" || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("got %d %v %q", rec.Code, rec.Header(), rec.Body)
		}
	})

	t.Run("provider failure is a 502 without secrets", func(t *testing.T) {
		h := newAPI(t, func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"bad key `+ttsKey+`"}`, http.StatusServiceUnavailable)
		})
		rec, body := send(h, postSpeak(`{"lang":"ru","text":"Привет"}`))
		if rec.Code != http.StatusBadGateway || errorCode(body) != "provider_error" {
			t.Fatalf("got %d %v, want 502 provider_error", rec.Code, body)
		}
		if strings.Contains(rec.Body.String(), ttsKey) {
			t.Fatalf("response leaks the provider key: %s", rec.Body)
		}
	})

	t.Run("a language without a server voice is 422 no_voice", func(t *testing.T) {
		h := newAPI(t, func(w http.ResponseWriter, r *http.Request) { t.Error("provider must not be called") })
		rec, body := send(h, postSpeak(`{"lang":"yue","text":"你喺邊度？"}`))
		if rec.Code != http.StatusUnprocessableEntity || errorCode(body) != "no_voice" {
			t.Fatalf("got %d %v, want 422 no_voice", rec.Code, body)
		}
	})
}
