// Package languages is the single source of truth for the supported languages
// and the Cartesia voice used for each.
package languages

type Language struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	NativeName string `json:"nativeName"`
	// Voice is the Cartesia voice id; empty when there is no server voice.
	Voice string `json:"-"`
}

// All lists the supported languages in display order. Codes are BCP 47.
var All = []Language{
	{"en", "English", "English", "30894953-bcce-41fe-892c-15ce19c843ff"},
	{"ko", "Korean", "한국어", "e1717dc3-b87b-4720-aa7f-b6db290e0609"},
	{"ru", "Russian", "Русский", "1e4176b1-3db9-44d6-a601-4fe68b041942"},
	{"uk", "Ukrainian", "Українська", "05ffab9c-d380-4909-8375-cd12f59238c3"},
	{"es-ES", "Spanish (Spain)", "Español (España)", "02aeee94-c02b-456e-be7a-659672acf82d"},
	{"es-419", "Spanish (Latin America)", "Español (Latinoamérica)", "2fc4f1ec-bfd0-46f1-8e6d-d4279eaaf838"},
	{"fr", "French", "Français", "996ec149-0dca-4389-ad08-e2d6f906b4bf"},
	{"de", "German", "Deutsch", "dff81230-ff75-49a4-af44-f6b2f43500d8"},
	{"it", "Italian", "Italiano", "79693aee-1207-4771-a01e-20c393c89e6f"},
	{"pt-BR", "Portuguese (Brazil)", "Português (Brasil)", "616c64d7-f541-436b-9b8d-e79cfbe19ef9"},
	{"pt-PT", "Portuguese (Portugal)", "Português (Portugal)", "e6b8bb73-2655-433d-8a10-7b8cf559d03b"},
	{"ja", "Japanese", "日本語", "b8e1169c-f16a-4064-a6e0-95054169e553"},
	{"zh-Hans", "Chinese (Mandarin, Simplified)", "中文（简体）", "653b9445-ae0c-4312-a3ce-375504cff31e"},
	{"zh-Hant", "Chinese (Taiwan)", "中文（台灣）", "453c418c-125e-4e5a-b048-03fec55d0963"},
	{"yue", "Cantonese", "粵語", ""}, // no Cartesia voice: the browser speaks
	{"vi", "Vietnamese", "Tiếng Việt", "0e58d60a-2f1a-4252-81bd-3db6af45fb41"},
	{"th", "Thai", "ไทย", "5de076e9-7b28-4442-b279-e7d80d573505"},
	{"hi", "Hindi", "हिन्दी", "910fb75e-1d20-4840-ac63-ac6b26a71bdc"},
	{"ar", "Arabic", "العربية", "f9f9f472-6247-4403-9abe-616f7c407c63"},
	{"he", "Hebrew", "עברית", "84b969ad-19c7-428d-b742-48d387f7f138"},
	{"tr", "Turkish", "Türkçe", "c1cfee3d-532d-47f8-8dd2-8e5b2b66bf1d"},
	{"pl", "Polish", "Polski", "d358377a-cd1d-45c5-abd0-701314e36cbe"},
	{"cs", "Czech", "Čeština", "82db1f84-5b96-4364-b04a-4c7ff80e2f8a"},
	{"nl", "Dutch", "Nederlands", "da743a82-ddf2-4d9b-8eb8-ff67ca0b138e"},
	{"sv", "Swedish", "Svenska", "8c889eba-5b31-4179-8fb2-37bbee22db64"},
	{"nb", "Norwegian", "Norsk bokmål", "d6dca1b6-cdd8-4e9c-823c-e03979261740"},
	{"da", "Danish", "Dansk", "a466f9e2-28eb-4bb7-925c-8e8984950700"},
	{"fi", "Finnish", "Suomi", "7849a11e-4107-44ae-bc7e-77bea41ec019"},
	{"el", "Greek", "Ελληνικά", "b45eba5b-2215-4da7-9c7c-121c95ed7b81"},
	{"hu", "Hungarian", "Magyar", "4c5c7be8-6b3b-4c62-b915-c54d049c198f"},
	{"ro", "Romanian", "Română", "3f64ef99-d87b-4b51-b217-df7351f7886a"},
	{"id", "Indonesian", "Bahasa Indonesia", "04b567df-2923-4b0c-896b-4b7df0a07e1a"},
	{"ms", "Malay", "Bahasa Melayu", "8281db18-6ac5-47bb-91a8-ce23a1f1d951"},
	{"fil", "Filipino", "Filipino", "42332792-6e9f-4b2c-a106-3ff97e34a79d"},
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
