package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
)

// chatCall is the part of a chat-completions request the tests look at.
type chatCall struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
	ResponseFormat struct {
		Type       string `json:"type"`
		JSONSchema struct {
			Strict bool `json:"strict"`
			Schema struct {
				Properties map[string]struct {
					Enum []string `json:"enum"`
				} `json:"properties"`
			} `json:"schema"`
		} `json:"json_schema"`
	} `json:"response_format"`
	Reasoning struct {
		Effort string `json:"effort"`
	} `json:"reasoning"`
	auth string
}

// fakeRouter is a fake OpenRouter: reply answers each call and the calls are
// kept in order for the test to inspect.
func fakeRouter(t *testing.T, reply func(w http.ResponseWriter, r *http.Request, call chatCall)) (http.HandlerFunc, func() []chatCall) {
	var mu sync.Mutex
	var calls []chatCall
	return func(w http.ResponseWriter, r *http.Request) {
			var call chatCall
			if r.URL.Path != "/chat/completions" || json.NewDecoder(r.Body).Decode(&call) != nil {
				t.Errorf("unexpected provider request %s", r.URL.Path)
			}
			call.auth = r.Header.Get("Authorization")
			mu.Lock()
			calls = append(calls, call)
			mu.Unlock()
			reply(w, r, call)
		}, func() []chatCall {
			mu.Lock()
			defer mu.Unlock()
			return calls
		}
}

// answer writes a chat-completions response whose message is content.
func answer(w http.ResponseWriter, content string) {
	body, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}},
		"usage":   map[string]int{"prompt_tokens": 300, "completion_tokens": 20},
	})
	w.Write(body)
}

func postTranslate(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/translate", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+appToken)
	return r
}

const okRequest = `{"languages":["ru","ko"],"text":"Где она?","history":[
	{"sourceLang":"ru","source":"Старый ход","targetLang":"ko","translation":"오래된"},
	{"sourceLang":"ru","source":"Это моя сестра Анна.","targetLang":"ko","translation":"제 여동생 안나예요."},
	{"sourceLang":"ko","source":"언제 봤어요?","targetLang":"ru","translation":"Когда вы её видели?"}]}`

func TestTranslate(t *testing.T) {
	t.Run("detects the language and sends the recent turns as context", func(t *testing.T) {
		provider, calls := fakeRouter(t, func(w http.ResponseWriter, r *http.Request, call chatCall) {
			answer(w, `{"detectedLang":"ru","translation":"그녀는 어디에 있어요?"}`)
		})
		rec, body := send(newAPI(t, provider), postTranslate(okRequest))
		if rec.Code != http.StatusOK {
			t.Fatalf("got %d %v", rec.Code, body)
		}
		want := map[string]any{"detectedLang": "ru", "targetLang": "ko", "translation": "그녀는 어디에 있어요?",
			"confident": true, "model": "primary-test", "usage": map[string]any{"input": 300.0, "output": 20.0}}
		for k, v := range want {
			if fmt.Sprint(body[k]) != fmt.Sprint(v) {
				t.Errorf("%s = %v, want %v", k, body[k], v)
			}
		}

		call := calls()[0]
		// The reasoning effort is the configured one, not a built-in default.
		if call.Model != "primary-test" || call.auth != "Bearer "+translateKey || call.Reasoning.Effort != "none" {
			t.Errorf("model %q, auth %q, reasoning %q", call.Model, call.auth, call.Reasoning.Effort)
		}
		if f := call.ResponseFormat; f.Type != "json_schema" || !f.JSONSchema.Strict ||
			fmt.Sprint(f.JSONSchema.Schema.Properties["detectedLang"].Enum) != "[ru ko other]" {
			t.Errorf("response_format %+v", f)
		}
		// ContextTurns is 2: the oldest turn is dropped; each kept turn is a user/assistant pair.
		var roles, contents []string
		for _, m := range call.Messages {
			roles = append(roles, m.Role)
			contents = append(contents, m.Content)
		}
		if fmt.Sprint(roles) != "[system user assistant user assistant user]" ||
			contents[1] != "Это моя сестра Анна." ||
			contents[4] != `{"detectedLang":"ko","translation":"Когда вы её видели?"}` ||
			contents[5] != "Где она?" ||
			!strings.Contains(contents[0], "Russian") || !strings.Contains(contents[0], "Korean") {
			t.Errorf("messages %q", contents)
		}
	})

	t.Run("text in neither language is translated into the second, unconfident", func(t *testing.T) {
		provider, calls := fakeRouter(t, func(w http.ResponseWriter, r *http.Request, call chatCall) {
			if _, detecting := call.ResponseFormat.JSONSchema.Schema.Properties["detectedLang"]; detecting {
				answer(w, `{"detectedLang":"other","translation":""}`)
				return
			}
			answer(w, `{"translation":"어디 있어요?"}`)
		})
		rec, body := send(newAPI(t, provider), postTranslate(`{"languages":["ru","ko"],"text":"Where is she?"}`))
		if rec.Code != http.StatusOK || body["detectedLang"] != "other" || body["targetLang"] != "ko" ||
			body["translation"] != "어디 있어요?" || body["confident"] != false {
			t.Fatalf("got %d %v", rec.Code, body)
		}
		if c := calls(); len(c) != 2 || !strings.Contains(c[1].Messages[0].Content, "into Korean") {
			t.Fatalf("want a second call asking for Korean, got %+v", c)
		}
	})

	failures := map[string]func(w http.ResponseWriter, r *http.Request){
		"HTTP 500":     func(w http.ResponseWriter, r *http.Request) { http.Error(w, "boom", http.StatusInternalServerError) },
		"invalid JSON": func(w http.ResponseWriter, r *http.Request) { answer(w, "Sure! Here is the translation:") },
		"timeout": func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-time.After(2 * time.Second):
			}
		},
	}
	for name, fail := range failures {
		t.Run("falls back once after primary "+name, func(t *testing.T) {
			provider, calls := fakeRouter(t, func(w http.ResponseWriter, r *http.Request, call chatCall) {
				if call.Model == "primary-test" {
					fail(w, r)
					return
				}
				answer(w, `{"detectedLang":"ru","translation":"그녀는 어디에 있어요?"}`)
			})
			short := func(c *config.Config) { c.ProviderTimeout = 200 * time.Millisecond }
			rec, body := send(newAPI(t, provider, short), postTranslate(okRequest))
			if rec.Code != http.StatusOK || body["model"] != "fallback-test" || len(calls()) != 2 {
				t.Fatalf("got %d %v after %d calls", rec.Code, body, len(calls()))
			}
		})
	}

	t.Run("both models failing is a 502 without secrets", func(t *testing.T) {
		provider, calls := fakeRouter(t, func(w http.ResponseWriter, r *http.Request, call chatCall) {
			http.Error(w, `{"error":{"message":"bad key `+translateKey+`"}}`, http.StatusUnauthorized)
		})
		rec, body := send(newAPI(t, provider), postTranslate(okRequest))
		if rec.Code != http.StatusBadGateway || errorCode(body) != "provider_error" || len(calls()) != 2 {
			t.Fatalf("got %d %v after %d calls", rec.Code, body, len(calls()))
		}
		if strings.Contains(rec.Body.String(), translateKey) {
			t.Fatalf("response leaks the provider key: %s", rec.Body)
		}
	})

	long := strings.Repeat("я", maxTextRunes+1)
	rejected := map[string]string{
		"same languages":       `{"languages":["ru","ru"],"text":"Привет"}`,
		"unknown language":     `{"languages":["ru","xx"],"text":"Привет"}`,
		"empty text":           `{"languages":["ru","ko"],"text":"  "}`,
		"text too long":        `{"languages":["ru","ko"],"text":"` + long + `"}`,
		"foreign history":      `{"languages":["ru","ko"],"text":"Привет","history":[{"sourceLang":"en","source":"a","targetLang":"ko","translation":"b"}]}`,
		"history without text": `{"languages":["ru","ko"],"text":"Привет","history":[{"sourceLang":"ru","source":"a","targetLang":"ko"}]}`,
	}
	for name, req := range rejected {
		t.Run("rejects "+name, func(t *testing.T) {
			h := newAPI(t, func(w http.ResponseWriter, r *http.Request) { t.Error("provider must not be called") })
			rec, body := send(h, postTranslate(req))
			if rec.Code != http.StatusBadRequest || errorCode(body) == "" {
				t.Fatalf("got %d %v, want 400", rec.Code, body)
			}
		})
	}
}
