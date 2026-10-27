// Package languages is the single source of truth for the supported languages
// and the Google voice used for each.
package languages

type Language struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	NativeName string `json:"nativeName"`
	Voice      string `json:"-"`
}

// All lists the supported languages in display order. Codes are BCP 47.
var All = []Language{
	{"en", "English", "English", "en-US-Wavenet-D"},
	{"ko", "Korean", "한국어", "ko-KR-Wavenet-C"},
	{"ru", "Russian", "Русский", "ru-RU-Wavenet-B"},
	{"uk", "Ukrainian", "Українська", "uk-UA-Wavenet-B"},
	{"es-ES", "Spanish (Spain)", "Español (España)", "es-ES-Wavenet-E"},
	{"es-419", "Spanish (Latin America)", "Español (Latinoamérica)", "es-US-Wavenet-B"},
	{"fr", "French", "Français", "fr-FR-Wavenet-G"},
	{"de", "German", "Deutsch", "de-DE-Wavenet-H"},
	{"it", "Italian", "Italiano", "it-IT-Wavenet-F"},
	{"pt-BR", "Portuguese (Brazil)", "Português (Brasil)", "pt-BR-Wavenet-B"},
	{"pt-PT", "Portuguese (Portugal)", "Português (Portugal)", "pt-PT-Wavenet-F"},
	{"ja", "Japanese", "日本語", "ja-JP-Wavenet-C"},
	{"zh-Hans", "Chinese (Mandarin, Simplified)", "中文（简体）", "cmn-CN-Wavenet-B"},
	{"zh-Hant", "Chinese (Taiwan)", "中文（台灣）", "cmn-TW-Wavenet-B"},
	{"yue", "Cantonese", "粵語", "yue-HK-Standard-B"},
	{"vi", "Vietnamese", "Tiếng Việt", "vi-VN-Wavenet-B"},
	{"th", "Thai", "ไทย", "th-TH-Standard-A"},
	{"hi", "Hindi", "हिन्दी", "hi-IN-Wavenet-B"},
	{"ar", "Arabic", "العربية", "ar-XA-Wavenet-B"},
	{"he", "Hebrew", "עברית", "he-IL-Wavenet-B"},
	{"tr", "Turkish", "Türkçe", "tr-TR-Wavenet-B"},
	{"pl", "Polish", "Polski", "pl-PL-Wavenet-G"},
	{"cs", "Czech", "Čeština", "cs-CZ-Wavenet-B"},
	{"nl", "Dutch", "Nederlands", "nl-NL-Wavenet-G"},
	{"sv", "Swedish", "Svenska", "sv-SE-Wavenet-C"},
	{"nb", "Norwegian", "Norsk bokmål", "nb-NO-Wavenet-G"},
	{"da", "Danish", "Dansk", "da-DK-Wavenet-G"},
	{"fi", "Finnish", "Suomi", "fi-FI-Wavenet-B"},
	{"el", "Greek", "Ελληνικά", "el-GR-Wavenet-B"},
	{"hu", "Hungarian", "Magyar", "hu-HU-Wavenet-B"},
	{"ro", "Romanian", "Română", "ro-RO-Wavenet-B"},
	{"id", "Indonesian", "Bahasa Indonesia", "id-ID-Wavenet-B"},
	{"ms", "Malay", "Bahasa Melayu", "ms-MY-Wavenet-B"},
	{"fil", "Filipino", "Filipino", "fil-PH-Wavenet-C"},
}

var byCode = func() map[string]Language {
	m := make(map[string]Language, len(All))
	for _, l := range All {
		m[l.Code] = l
	}
	return m
}()

// Lookup returns the language with the exact code.
func Lookup(code string) (Language, bool) {
	l, ok := byCode[code]
	return l, ok
}
