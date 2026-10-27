# Pocket Tolk — Design system

Status: written in slice 1 (2026-10-26). Later slices reuse it; change it deliberately.

## Subject, audience, job

A phone lying between two strangers who share no language: a pharmacy counter, a taxi, a market stall. The owner sets it up; the other person, often older and never having seen the app, reads it at arm's length and presses the same button. The screen's job is to make whose turn it is, what was heard, and what to press next obvious in a glance, one-handed, in daylight.

## Palette

Six named colours. Light is the primary appearance (daylight, outdoors); dark follows `prefers-color-scheme`.

| Name | Light | Dark | Role |
|---|---|---|---|
| Paper | `#F4F6FA` | `#0F1830` (Night) | page background; dark is a deep ink navy, not a stand-in for black |
| Sheet | `#FFFFFF` | `#17223F` | editable fields, menus, dialogs |
| Ink | `#172554` | `#E8ECF6` | text, the idle record button, the "you" voice |
| Slate | `#566079` | `#A3ADC4` | secondary text, hints, field borders use a stronger `#7C869C` / `#6B7899` |
| Ochre | `#A15C00` | `#F2B04C` | the "they" voice: their language chip and the rule beside their words |
| Tally | `#D62839` | `#FF5161` | live microphone only. Nothing else is red; errors use Ink text with an icon |

Focus rings use Signal `#2F5BFF` / `#8FA6FF`, 2 px solid with a 2 px offset, on every interactive element.

## Type

- Chrome face: **Atkinson Hyperlegible Next** (variable, self-hosted from `@fontsource-variable`). Designed for low-vision legibility, with deliberately distinct letterforms; it suits text read by a stranger across a counter. Used for titles, buttons, labels, the timer. Fallback `system-ui` with `font-size-adjust: from-font` so a slow load does not shift the layout.
- User text face: **system-ui stack** (`ui-sans-serif, system-ui, sans-serif`). Every element that shows words a person said (transcripts now, translations later) carries a `lang` attribute and `dir="auto"`, so the OS picks the right Hangul, Han (Simplified, Traditional, Japanese), Cyrillic, Thai, Arabic or Hebrew glyphs. The chrome face never renders user text.
- Scale (Bringhurst's classic steps, in rem from a 16 px root that follows OS text size), mapped onto Tailwind's size names so class mergers never drop them: `text-sm` 0.875 hints, `text-base` 1 body, `text-lg` 1.125 buttons, `text-xl` 1.3125 transcript, `text-2xl` 1.5 titles and timer, `text-4xl` 2.25 translation (slice 2). Titles weight 700, buttons 600, body 400. Timer uses tabular numerals of the chrome face (its slashed zero is part of the legibility design), not a monospace font.
- Korean user text uses `word-break: keep-all` so lines break between words.
- No all-caps labels, no tracked-out eyebrows, no middle-dot meta strings, no arrows appended to button text.

## Layout

One column, left-aligned, max width 34 rem centred on larger screens. The page has three bands: a slim header, the words, and the dock. The dock sits in the thumb zone (sticky to the bottom, above the home indicator via `env(safe-area-inset-bottom)`) and holds every control for the current state; the band above it is only for words.

Session screen, 390 px wide:

```
idle                                   recording
┌────────────────────────────────────┐ ┌────────────────────────────────────┐
│ ‹  [Русский] ⇄ [한국어]            │ │ ‹  [Русский] ⇄ [한국어]            │
│                                    │ │                                    │
│ Press the button and speak         │ │ Listening…                         │
│ Русский or 한국어.                  │ │                                    │
│                                    │ │                                    │
│                                    │ │                                    │
├────────────────────────────────────┤ ├────────────────────────────────────┤
│           ╭────────────╮           │ │ ╭────────────────────────────────╮ │
│           │     🎙     │  Ink      │ │ │ ■  0:07   ▂▄▇▅▃▆█▅▂▁▃▅  Tally  │ │
│           ╰────────────╯           │ │ ╰────────────────────────────────╯ │
│            Tap to speak            │ │     Tap to stop. Stops at 2:00.    │
└────────────────────────────────────┘ └────────────────────────────────────┘

review
┌────────────────────────────────────┐
│ ‹  [Русский] ⇄ [한국어]            │
│                                    │
│ ┃ 클라우드 기계 학습을 사용하면     │  editable, 21 px system-ui, lang="ko",
│ ┃ 앱에서 이미지, 텍스트 등을 해석할  │  rule in the speaker's voice colour
│ ┃ 수 있습니다.                      │
├────────────────────────────────────┤
│ [ ↻ Record again ] [ ＋ Add more ] │  secondary, 48 px tall
│ [             Send             ]   │  primary (disabled in slice 1)
│ Translation is coming next.        │
└────────────────────────────────────┘
```

Token and new-session screens use the same bands: title and explanation at the top left, fields in the middle, the one primary action in the dock. The language pickers carry the voice colour as a dot before their labels ("You speak", "They speak"). Confirmations (leaving a conversation with unsent text) open as a dialog anchored above the home indicator, not in the middle of the screen.

## The one bold thing

The record button. Idle, it is a wide Ink stadium with a microphone. Pressed, it grows across the dock into a Tally-red live strip that holds the stop square, the timer and a row of level bars that move with the voice, like the on-air lamp of an interpreter's booth. That morph and the bars are the only animation in the app (motion/react, springs off under `prefers-reduced-motion`, where the swap is instant and the bars update without easing). Everything around it stays quiet.

## Principles

1. Every control lives in the dock under the thumb; the space above is for words.
2. Words are for two readers: big, system-rendered, language-tagged, never in the display face.
3. Red means the microphone is live. Nothing else is red.
4. Colour says whose words they are: Ink for "you", Ochre for "they", on the language chips and on the rule beside a transcript.
5. Motion only answers a press.
6. Copy names what happens: "Record again", "Add more", "Send". Errors say what went wrong and what to press.

## Mobile floor

Touch targets at least 48 px (44 px minimum), `touch-action: manipulation` on the record button, `viewport-fit=cover` with safe-area padding, `interactive-widget=resizes-content` so Android resizes for the keyboard, normal document scrolling so iOS can scroll a focused field into view, form controls at 16 px or more so iOS does not zoom, `color-scheme: light dark`, visible `:focus-visible` rings, `<meta name="text-scale" content="scale">` with rem sizing.

## Review against generic defaults

First draft, and what changed:

- Draft used Inter for everything. Generic. Replaced with Atkinson Hyperlegible Next for chrome (a legibility face with a reason to be here) and system-ui for user text (a hard requirement for Hangul, Han, Thai, Arabic and Hebrew).
- Draft put the transcript in a white rounded card with a soft grey shadow. That is the SaaS card kit. Replaced with text on the page and a coloured rule that carries information (whose words).
- Draft had a red circular record button like a voice-memo app. Red is kept but only as the live state; the idle button is Ink, and the live state is a full-width strip with the meter inside, so the button itself shows that it is listening.
- Draft dark mode was `#111` with an indigo accent. Replaced with a deep ink navy (Night) so dark mode reads as the same ink-on-paper idea inverted.
- Checked and avoided: cream and terracotta, black with one acid accent, broadsheet hairlines, uppercase eyebrows, middle-dot meta, monospace data labels, arrows in button text.

## Critique log

Slice 1, looked at in a 390 × 844 viewport in light and dark:

- The record strip did not reach full width: its wrapper was shrink-wrapped by the dock, so `100%` was circular. The wrapper is now full width.
- During the morph the level bars overlapped the timer. The meter now clips its oldest bars instead.
- A voice-coloured left border on the rounded language pickers read as a rendering glitch. Replaced by a voice dot before the label.
- The language menu was wider than the phone (long names such as "Español (Latinoamérica)"). It now matches the trigger width and wraps the English name under the native one.
- Custom size names (`text-speech`) were silently dropped when combined with a text colour in `cn()`. Moved the scale onto Tailwind's names.
- Korean transcripts broke inside words. Added `keep-all`.
- The leave dialog sat in the middle of the screen, away from the thumb. Anchored it to the bottom.
