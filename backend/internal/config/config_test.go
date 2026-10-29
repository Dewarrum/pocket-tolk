package config

import (
	"strings"
	"testing"
)

func TestLoadListsEveryMissingVariable(t *testing.T) {
	_, err := Load(func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "APP_TOKEN, ALLOWED_ORIGIN, STT_API_KEY, TRANSLATE_API_KEY, TTS_API_KEY") {
		t.Fatalf("got %v", err)
	}
}
