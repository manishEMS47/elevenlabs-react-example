// ElevenLabs adapter. Mirrors the original AudioStream.tsx behaviour but behind
// the shared TTSProvider interface.
//
// ElevenLabs auth uses the `xi-api-key` header and returns a raw MP3 blob.
// Voice settings are on a 0..1 scale, so the normalized settings map directly.

import { config } from "../config";
import type {
  SynthesisResult,
  SynthesizeRequest,
  TTSProvider,
  Voice,
} from "./types";

const { baseUrl, apiKey, defaultVoiceId } = config.elevenLabs;

async function synthesize(
  req: SynthesizeRequest,
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  const res = await fetch(`${baseUrl}/text-to-speech/${req.voiceId}`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: req.text,
      // ElevenLabs expects 0..1 — our normalized form is already 0..1.
      voice_settings: {
        stability: req.settings.stability,
        similarity_boost: req.settings.similarity,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs error ${res.status}: ${await res.text()}`);
  }

  const blob = await res.blob();
  return { blob, url: URL.createObjectURL(blob) };
}

// ElevenLabs voices endpoint (no key needed beyond the header). Surfaced so the
// shared voice picker can be populated for either provider.
async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const res = await fetch(`${baseUrl}/voices`, {
    signal,
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
  };
  return json.voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    accent: v.labels?.accent,
    gender: v.labels?.gender,
  }));
}

export const elevenLabsProvider: TTSProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  defaultVoiceId,
  capabilities: {
    synthesize: true,
    httpStream: false,
    webSocket: false,
    listVoices: true,
    stt: false,
  },
  isConfigured: () => apiKey.length > 0,
  synthesize,
  listVoices,
};
