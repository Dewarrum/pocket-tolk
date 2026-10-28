// Package config reads the service configuration from environment variables.
package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port            string
	AppToken        string
	AllowedOrigin   string
	ProviderTimeout time.Duration
	MaxUploadBytes  int64
	STT             STT
	Translate       Translate
	TTS             TTS
}

type STT struct {
	BaseURL string
	APIKey  string
	Model   string
}

type Translate struct {
	BaseURL       string
	APIKey        string
	Model         string
	FallbackModel string
	ContextTurns  int
	// ReasoningEffort is sent as OpenRouter's reasoning.effort.
	ReasoningEffort string
}

type TTS struct {
	BaseURL string
	APIKey  string
	Model   string
}

// Load builds a Config from getenv, applying defaults. It reports every
// missing required variable and every malformed number in one error.
func Load(getenv func(string) string) (Config, error) {
	var missing, invalid []string

	required := func(name string) string {
		v := strings.TrimSpace(getenv(name))
		if v == "" {
			missing = append(missing, name)
		}
		return v
	}
	optional := func(name, def string) string {
		if v := strings.TrimSpace(getenv(name)); v != "" {
			return v
		}
		return def
	}
	positiveInt := func(name string, def int) int {
		raw := optional(name, strconv.Itoa(def))
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			invalid = append(invalid, fmt.Sprintf("%s=%q (want a positive integer)", name, raw))
			return def
		}
		return n
	}

	cfg := Config{
		Port:            optional("PORT", "8080"),
		AppToken:        required("APP_TOKEN"),
		AllowedOrigin:   required("ALLOWED_ORIGIN"),
		ProviderTimeout: time.Duration(positiveInt("PROVIDER_TIMEOUT_SECONDS", 30)) * time.Second,
		MaxUploadBytes:  int64(positiveInt("MAX_UPLOAD_MB", 25)) << 20,
		STT: STT{
			BaseURL: strings.TrimRight(optional("STT_BASE_URL", "https://api.groq.com/openai/v1"), "/"),
			APIKey:  required("STT_API_KEY"),
			Model:   optional("STT_MODEL", "whisper-large-v3-turbo"),
		},
		Translate: Translate{
			BaseURL:         strings.TrimRight(optional("TRANSLATE_BASE_URL", "https://openrouter.ai/api/v1"), "/"),
			APIKey:          required("TRANSLATE_API_KEY"),
			Model:           optional("TRANSLATE_MODEL", "openai/gpt-6-luna"),
			FallbackModel:   optional("TRANSLATE_FALLBACK_MODEL", "anthropic/claude-haiku-5.5"),
			ContextTurns:    positiveInt("TRANSLATE_CONTEXT_TURNS", 10),
			ReasoningEffort: optional("TRANSLATE_REASONING_EFFORT", "minimal"),
		},
		TTS: TTS{
			BaseURL: strings.TrimRight(optional("TTS_BASE_URL", "https://api.cartesia.ai"), "/"),
			APIKey:  required("TTS_API_KEY"),
			Model:   optional("TTS_MODEL", "sonic-3.6"),
		},
	}

	var problems []string
	if len(missing) > 0 {
		problems = append(problems, "missing required environment variables: "+strings.Join(missing, ", "))
	}
	if len(invalid) > 0 {
		problems = append(problems, "invalid values: "+strings.Join(invalid, ", "))
	}
	if len(problems) > 0 {
		return Config{}, fmt.Errorf("%s", strings.Join(problems, "; "))
	}
	return cfg, nil
}
