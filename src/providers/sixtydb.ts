// 60db adapter. Implements the full surface: one-shot TTS, HTTP streaming,
// WebSocket streaming, voice listing, and speech-to-text.
//
// Differences from ElevenLabs that this adapter normalizes away:
//   - Auth is `Authorization: Bearer <key>` (not `xi-api-key`).
//   - One-shot TTS returns JSON with base64 audio (not a raw blob).
//   - Settings use a 0..100 scale (not 0..1) — scaled here.
//   - It additionally exposes streaming, websocket, voices, and STT.

import { config } from "../config";
import {
  base64ToAudioBlob,
  base64ToBytes,
  bytesToBlob,
} from "../lib/audio";
import type {
  SynthesisResult,
  SynthesizeRequest,
  StreamCallbacks,
  TranscribeRequest,
  TranscriptResult,
  TTSProvider,
  Voice,
  WebSocketCallbacks,
  WebSocketSession,
} from "./types";

const { baseUrl, wsUrl, apiKey, defaultVoiceId } = config.sixtyDb;

function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

// Map our normalized 0..1 settings to the 60db request body (0..100 scale).
function toBody(req: SynthesizeRequest) {
  return {
    text: req.text,
    voice_id: req.voiceId,
    enhance: req.settings.enhance,
    speed: req.settings.speed,
    stability: Math.round(req.settings.stability * 100),
    similarity: Math.round(req.settings.similarity * 100),
    output_format: req.outputFormat,
  };
}

// Response audio field name is documented loosely; accept the likely keys.
function extractAudio(obj: Record<string, unknown>): string | undefined {
  return (obj.audioContent ?? obj.audio ?? obj.audio_content ?? obj.data) as
    | string
    | undefined;
}

// ---------------------------------------------------------------------------
// One-shot TTS — POST /tts-synthesize
// ---------------------------------------------------------------------------
async function synthesize(
  req: SynthesizeRequest,
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  const res = await fetch(`${baseUrl}/tts-synthesize`, {
    method: "POST",
    signal,
    headers: authHeaders(),
    body: JSON.stringify(toBody(req)),
  });

  if (!res.ok) {
    throw new Error(`60db error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (json.success === false) {
    throw new Error(`60db error: ${String(json.message ?? "synthesis failed")}`);
  }

  const audio = extractAudio(json);
  if (!audio) throw new Error("60db response did not contain audio data");

  const format = (json.output_format as string) ?? req.outputFormat;
  const blob = base64ToAudioBlob(audio, format);
  return { blob, url: URL.createObjectURL(blob) };
}

// ---------------------------------------------------------------------------
// HTTP streaming — POST /tts-stream (newline-delimited JSON)
// Each line is { type: "chunk" | "complete" | "error", result?: {audioContent}, message? }
// ---------------------------------------------------------------------------
async function stream(
  req: SynthesizeRequest,
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  const res = await fetch(`${baseUrl}/tts-stream`, {
    method: "POST",
    signal,
    headers: authHeaders(),
    body: JSON.stringify(toBody(req)),
  });

  if (!res.ok || !res.body) {
    throw new Error(`60db error ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let buffer = "";
  let index = 0;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: { type?: string; result?: { audioContent?: string }; message?: string };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // ignore malformed/partial lines
    }
    if (msg.type === "error") {
      throw new Error(`60db stream error: ${msg.message ?? "unknown"}`);
    }
    if (msg.type === "chunk" && msg.result?.audioContent) {
      const bytes = base64ToBytes(msg.result.audioContent);
      chunks.push(bytes);
      cb.onChunk?.({ index: index++, bytes: bytes.byteLength });
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep the trailing partial line
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  cb.onComplete?.();
  const blob = bytesToBlob(chunks, req.outputFormat);
  return { blob, url: URL.createObjectURL(blob) };
}

// ---------------------------------------------------------------------------
// WebSocket streaming — ws://api.60db.ai/ws/tts?apiKey=...
// Context lifecycle: create_context -> send_text* -> flush_context -> close_context
// Audio arrives as LINEAR16 (16-bit PCM) chunks the caller can play live.
// ---------------------------------------------------------------------------
function openWebSocket(
  req: SynthesizeRequest,
  cb: WebSocketCallbacks,
): WebSocketSession {
  // A stable-ish context id without Date.now()/Math.random() (unavailable here
  // in some contexts) — fine for a single live session.
  const contextId = `ctx-${req.voiceId.slice(0, 8)}-${req.text.length}`;
  const sampleRate = 24000;

  const ws = new WebSocket(`${wsUrl}?apiKey=${encodeURIComponent(apiKey)}`);

  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.onopen = () => {
    cb.onOpen?.();
    send({
      create_context: {
        context_id: contextId,
        voice_id: req.voiceId,
        audio_config: {
          audio_encoding: "LINEAR16",
          sample_rate_hertz: sampleRate,
        },
        speed: req.settings.speed,
        stability: Math.round(req.settings.stability * 100),
        similarity: Math.round(req.settings.similarity * 100),
      },
    });
  };

  ws.onmessage = (event) => {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.context_created) {
      // Context is ready — push the text and request synthesis.
      send({ send_text: { context_id: contextId, text: req.text } });
      send({ flush_context: { context_id: contextId } });
    } else if (msg.audio_chunk?.audioContent) {
      cb.onAudio?.(base64ToBytes(msg.audio_chunk.audioContent));
    } else if (msg.flush_completed) {
      cb.onFlushComplete?.();
    } else if (msg.error) {
      cb.onError?.(String(msg.error?.message ?? msg.error));
    }
  };

  ws.onerror = () => cb.onError?.("WebSocket connection error");
  ws.onclose = () => cb.onClose?.();

  return {
    sendText: (text: string) =>
      send({ send_text: { context_id: contextId, text } }),
    flush: () => send({ flush_context: { context_id: contextId } }),
    close: () => {
      send({ close_context: { context_id: contextId } });
      ws.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Voices — GET /myvoices
// ---------------------------------------------------------------------------
async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const res = await fetch(`${baseUrl}/myvoices`, {
    signal,
    headers: authHeaders(false),
  });
  if (!res.ok) {
    throw new Error(`60db error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: Array<{
      voice_id: string;
      name: string;
      description?: string | null;
      labels?: { language_name?: string; gender?: string; accent?: string };
    }>;
  };
  return (json.data ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    description: v.description ?? undefined,
    language: v.labels?.language_name,
    gender: v.labels?.gender,
    accent: v.labels?.accent,
  }));
}

// ---------------------------------------------------------------------------
// Speech-to-text — POST /stt (multipart/form-data)
// ---------------------------------------------------------------------------
async function transcribe(
  req: TranscribeRequest,
  signal?: AbortSignal,
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", req.file);
  if (req.language) form.append("language", req.language);
  if (req.diarize) form.append("diarize", "true");

  const res = await fetch(`${baseUrl}/stt`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}` }, // let the browser set the multipart boundary
    body: form,
  });
  if (!res.ok) {
    throw new Error(`60db error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    text: string;
    language?: string;
    language_name?: string;
    duration_sec?: number;
  };
  return {
    text: json.text,
    language: json.language,
    languageName: json.language_name,
    durationSec: json.duration_sec,
    raw: json,
  };
}

export const sixtyDbProvider: TTSProvider = {
  id: "60db",
  label: "60db",
  defaultVoiceId,
  capabilities: {
    synthesize: true,
    httpStream: true,
    webSocket: true,
    listVoices: true,
    stt: true,
  },
  isConfigured: () => apiKey.length > 0,
  synthesize,
  stream,
  openWebSocket,
  listVoices,
  transcribe,
};
