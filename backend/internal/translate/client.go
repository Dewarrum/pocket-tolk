// Package translate is a client for an OpenRouter-shaped chat-completions API
// (POST {base}/chat/completions). One call detects which of the two session
// languages a text is in and translates it into the other.
package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/Dewarrum/pocket-tolk/backend/internal/config"
	"github.com/Dewarrum/pocket-tolk/backend/internal/languages"
)

// Other is the detected language when the text is in neither session language.
const Other = "other"

type Client struct {
	cfg     config.Translate
	timeout time.Duration
	http    *http.Client
	log     *slog.Logger
}

func New(cfg config.Translate, timeout time.Duration, log *slog.Logger) *Client {
	return &Client{cfg: cfg, timeout: timeout, http: &http.Client{}, log: log}
}

// Turn is an earlier, already translated turn of the conversation.
type Turn struct {
	SourceLang  string `json:"sourceLang"` // a session code or Other
	Source      string `json:"source"`
	TargetLang  string `json:"targetLang"`
	Translation string `json:"translation"`
}

type Request struct {
	Languages [2]languages.Language
	Text      string
	// History is oldest first; only the last ContextTurns entries are sent.
	History []Turn
}

type Usage struct {
	Input  int `json:"input"`
	Output int `json:"output"`
}

type Result struct {
	DetectedLang string // a session code or Other
	TargetLang   string
	Translation  string
	// Confident is false when the text was in neither language and was
	// translated into Languages[1] as a best guess.
	Confident bool
	Model     string // the model that produced the translation
	Latency   time.Duration
	Usage     Usage // summed over every successful provider call
}

// ProviderError means the provider failed, did not answer in time, or sent an
// answer that is not the requested JSON. Its message is safe to show to the
// caller: it never contains provider response bodies or credentials.
type ProviderError struct {
	Status  int // HTTP status from the provider, 0 when there was no response
	Timeout bool
	reason  string
}

func (e *ProviderError) Error() string { return "translation provider " + e.reason }

// Translate detects the language of req.Text and translates it into the other
// session language. Text in neither language goes to Languages[1] with
// Confident false, through a second call that names that target.
func (c *Client) Translate(ctx context.Context, req Request) (Result, error) {
	start := time.Now()
	history := req.History
	if n := c.cfg.ContextTurns; len(history) > n {
		history = history[len(history)-n:]
	}
	a, b := req.Languages[0], req.Languages[1]

	var detected struct {
		DetectedLang string `json:"detectedLang"`
		Translation  string `json:"translation"`
	}
	first, err := c.complete(ctx, chat{
		system:  detectPrompt(a, b),
		format:  detectFormat(a, b),
		history: history,
		text:    req.Text,
	}, func(content string) bool {
		detected.DetectedLang, detected.Translation = "", ""
		if json.Unmarshal([]byte(content), &detected) != nil {
			return false
		}
		// For "other" the translation is ignored: a second call names the target.
		return detected.DetectedLang == Other ||
			slices.Contains([]string{a.Code, b.Code}, detected.DetectedLang) && strings.TrimSpace(detected.Translation) != ""
	})
	if err != nil {
		return Result{}, err
	}

	res := Result{
		DetectedLang: detected.DetectedLang,
		Translation:  strings.TrimSpace(detected.Translation),
		Confident:    true,
		Model:        first.model,
		Usage:        first.usage,
	}
	switch detected.DetectedLang {
	case a.Code:
		res.TargetLang = b.Code
	case b.Code:
		res.TargetLang = a.Code
	default:
		var fixed struct {
			Translation string `json:"translation"`
		}
		second, err := c.complete(ctx, chat{
			system:  fixedTargetPrompt(a, b),
			format:  fixedTargetFormat(),
			history: history,
			text:    req.Text,
			fixed:   true,
		}, func(content string) bool {
			fixed.Translation = ""
			return json.Unmarshal([]byte(content), &fixed) == nil && strings.TrimSpace(fixed.Translation) != ""
		})
		if err != nil {
			return Result{}, err
		}
		res.TargetLang = b.Code
		res.Translation = strings.TrimSpace(fixed.Translation)
		res.Confident = false
		res.Model = second.model
		res.Usage.Input += second.usage.Input
		res.Usage.Output += second.usage.Output
	}
	res.Latency = time.Since(start)
	return res, nil
}

func detectPrompt(a, b languages.Language) string {
	return fmt.Sprintf(`You are interpreting a live spoken conversation between two people who share one phone. One speaks %[1]s, the other speaks %[2]s. Each user message is what one of them just said, as recognised by speech-to-text, so punctuation may be missing.

Decide whether the message is in %[1]s or %[2]s and translate it into the other of the two languages. Earlier messages are the conversation so far: use them to resolve pronouns, omitted subjects and references, but translate only the latest message.

Set detectedLang to %[3]q for %[1]s, %[4]q for %[2]s, or "other" if the message is in neither language. Put only the translation in translation: keep names, numbers, register and tone; add no explanations, notes, quotes or transliterations.`,
		a.Name, b.Name, a.Code, b.Code)
}

func fixedTargetPrompt(a, b languages.Language) string {
	return fmt.Sprintf(`You are interpreting a live spoken conversation between two people who share one phone. One speaks %[1]s, the other speaks %[2]s. Each user message is what one of them just said, as recognised by speech-to-text, so punctuation may be missing.

Translate the latest message into %[2]s. Earlier messages are the conversation so far: use them to resolve pronouns, omitted subjects and references, but translate only the latest message. Put only the translation in translation: keep names, numbers, register and tone; add no explanations, notes, quotes or transliterations.`,
		a.Name, b.Name)
}

// chat is one request to the model. History is rendered as prior user and
// assistant messages: the user message is what was said and the assistant
// message is the JSON answer the model would have given, so the model reads
// the conversation as its own earlier work and keeps the answer format.
type chat struct {
	system  string
	format  responseFormat
	history []Turn
	text    string
	fixed   bool // the fixed-target answer shape, without detectedLang
}

func (ch chat) messages() []message {
	msgs := make([]message, 0, 2+2*len(ch.history))
	msgs = append(msgs, message{"system", ch.system})
	for _, t := range ch.history {
		var answer []byte
		if ch.fixed {
			answer, _ = json.Marshal(map[string]string{"translation": t.Translation})
		} else {
			answer, _ = json.Marshal(map[string]string{"detectedLang": t.SourceLang, "translation": t.Translation})
		}
		msgs = append(msgs, message{"user", t.Source}, message{"assistant", string(answer)})
	}
	return append(msgs, message{"user", ch.text})
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseFormat struct {
	Type       string     `json:"type"`
	JSONSchema jsonSchema `json:"json_schema"`
}

type jsonSchema struct {
	Name   string         `json:"name"`
	Strict bool           `json:"strict"`
	Schema map[string]any `json:"schema"`
}

func detectFormat(a, b languages.Language) responseFormat {
	return responseFormat{"json_schema", jsonSchema{Name: "translation", Strict: true, Schema: map[string]any{
		"type": "object",
		"properties": map[string]any{
			"detectedLang": map[string]any{"type": "string", "enum": []string{a.Code, b.Code, Other}},
			"translation":  map[string]any{"type": "string"},
		},
		"required":             []string{"detectedLang", "translation"},
		"additionalProperties": false,
	}}}
}

func fixedTargetFormat() responseFormat {
	return responseFormat{"json_schema", jsonSchema{Name: "translation", Strict: true, Schema: map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"translation": map[string]any{"type": "string"}},
		"required":             []string{"translation"},
		"additionalProperties": false,
	}}}
}

type answer struct {
	model string
	usage Usage
}

// complete asks the primary model and, when that fails in any way (error,
// non-2xx, timeout, or an answer accept rejects), the fallback model once.
// accept parses the answer into the caller's value and reports whether it is usable.
func (c *Client) complete(ctx context.Context, ch chat, accept func(content string) bool) (answer, error) {
	a, err := c.call(ctx, c.cfg.Model, ch, accept, false)
	if _, ok := errors.AsType[*ProviderError](err); !ok {
		return a, err // success, or the caller went away
	}
	return c.call(ctx, c.cfg.FallbackModel, ch, accept, true)
}

type chatRequest struct {
	Model          string         `json:"model"`
	Messages       []message      `json:"messages"`
	ResponseFormat responseFormat `json:"response_format"`
	Reasoning      *reasoning     `json:"reasoning,omitempty"`
}

// reasoning is OpenRouter's unified reasoning parameter.
type reasoning struct {
	Effort string `json:"effort"`
}

func (c *Client) call(ctx context.Context, model string, ch chat, accept func(string) bool, fallback bool) (answer, error) {
	body, err := json.Marshal(chatRequest{
		Model:          model,
		Messages:       ch.messages(),
		ResponseFormat: ch.format,
		Reasoning:      &reasoning{Effort: "minimal"},
	})
	if err != nil {
		return answer{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return answer{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	content, usage, status, err := c.do(req)
	if err == nil && !accept(content) {
		err = &ProviderError{Status: status, reason: "sent an answer that is not the requested JSON"}
	}
	latency := time.Since(start)

	attrs := []any{"stage", "translate", "model", model, "latencyMs", latency.Milliseconds(), "status", status,
		"inputTokens", usage.Input, "outputTokens", usage.Output, "fallback", fallback}
	if err != nil {
		c.log.Warn("provider call", append(attrs, "error", err.Error())...)
		return answer{}, err
	}
	c.log.Info("provider call", attrs...)
	return answer{model: model, usage: usage}, nil
}

func (c *Client) do(req *http.Request) (content string, usage Usage, status int, err error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return "", usage, 0, c.transportError(req)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return "", usage, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: fmt.Sprintf("returned HTTP %d", resp.StatusCode)}
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		if req.Context().Err() != nil {
			return "", usage, resp.StatusCode, c.transportError(req)
		}
		return "", usage, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: "sent an unreadable response"}
	}
	usage = Usage{Input: out.Usage.PromptTokens, Output: out.Usage.CompletionTokens}
	// OpenRouter reports some failures as a 200 without choices.
	if len(out.Choices) == 0 {
		return "", usage, resp.StatusCode, &ProviderError{Status: resp.StatusCode, reason: "sent no answer"}
	}
	return out.Choices[0].Message.Content, usage, resp.StatusCode, nil
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
