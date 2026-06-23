# ElevenLabs + 60db TTS/STT React Example

A Vite + React + TypeScript demo that talks to **two** speech providers —
[ElevenLabs](https://elevenlabs.io) and [60db](https://60db.ai) — through a
single shared abstraction. Pick a provider from a dropdown; the same controls
drive both. Capabilities a provider doesn't support are automatically disabled.

## Features

| Capability | ElevenLabs | 60db |
| --- | --- | --- |
| One-shot synthesis | ✅ | ✅ |
| HTTP streaming (NDJSON) | — | ✅ |
| WebSocket streaming (live PCM) | — | ✅ |
| List voices | ✅ | ✅ |
| Speech-to-text | — | ✅ |

## Architecture

Everything is built around the `TTSProvider` interface so the UI never knows
which vendor it's talking to.

```
src/
  config.ts                 # reads API keys from Vite env vars
  lib/audio.ts              # base64 helpers + streaming PCM player (Web Audio)
  providers/
    types.ts                # TTSProvider interface + normalized VoiceSettings
    elevenlabs.ts           # ElevenLabs adapter  (xi-api-key, blob response)
    sixtydb.ts              # 60db adapter        (Bearer auth, base64/JSON, WS, STT)
    index.ts                # provider registry
  components/TTSPanel.tsx   # the UI — provider selector + all controls
  App.tsx
```

**Consistency layer.** Voice settings live in one normalized 0–1 form
(`VoiceSettings`). Each adapter scales them to its own API: ElevenLabs uses 0–1
directly, 60db is scaled to 0–100. Both adapters return a playable object URL,
so playback is identical regardless of provider.

### Provider differences the abstraction hides

| | ElevenLabs | 60db |
| --- | --- | --- |
| Auth header | `xi-api-key: <key>` | `Authorization: Bearer <key>` |
| TTS endpoint | `POST /v1/text-to-speech/{voiceId}` | `POST /tts-synthesize` |
| TTS response | raw MP3 blob | JSON with base64 audio |
| Settings scale | 0–1 | 0–100 |

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your API keys. Copy `.env.example` to `.env.local` and fill them in:

   ```bash
   cp .env.example .env.local
   ```

   ```
   VITE_ELEVENLABS_API_KEY=...
   VITE_60DB_API_KEY=...
   ```

3. Run the dev server:

   ```bash
   npm run dev
   ```

## Using the app

Open the dev server URL. Pick a provider from the **Provider** dropdown
(`ElevenLabs` or `60db`). Providers without a key show `(no key)` and report a
clear error if you try to use them. Buttons for features the selected provider
doesn't support are disabled automatically.

**Text-to-speech (both providers)**
1. Select a provider.
2. (Optional, 60db/ElevenLabs) click **Load voices** to fetch your account
   voices into the dropdown, or just type a `voiceId`.
3. Type your text and adjust **Stability / Similarity / Speed** (0–1 sliders;
   60db also uses **Enhance** and **Output format**).
4. Click **Synthesize** — audio plays and appears in the player.

**HTTP streaming (60db only)**
- Click **HTTP stream**. The status line updates as each NDJSON chunk arrives,
  then plays the assembled audio. Good for long text.

**WebSocket streaming (60db only)**
- Click **WebSocket stream**. Audio is decoded from live LINEAR16 PCM chunks and
  played back-to-back through the Web Audio API as it arrives — lowest latency.

**Speech-to-text (60db only)**
- In the **Speech-to-Text** section, choose an audio file, set a language
  (`auto` to auto-detect), optionally enable **Diarize**, then **Transcribe**.
  The transcript is displayed below.

## Security note

These keys are bundled into client-side code and sent directly from the
browser — fine for a local demo, but in production you should proxy the calls
through a backend so keys never reach the client.

## Notes / things to verify against a live key

The 60db adapter is written to the published docs. A couple of fields are
documented loosely and handled defensively, so confirm them once you have a key:

- **`/tts-synthesize` audio field name** — the adapter accepts `audioContent`,
  `audio`, `audio_content`, or `data` (`src/providers/sixtydb.ts`).
- **WebSocket scheme/CORS** — the docs list `ws://api.60db.ai/ws/tts`. Browsers
  block insecure `ws://` from an `https://` page; you may need `wss://`.
- **CORS** — calling these APIs directly from the browser depends on the vendor
  sending permissive CORS headers. If 60db doesn't, route through a dev proxy.
