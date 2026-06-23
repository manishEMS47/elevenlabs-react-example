// Shared contract that every TTS/STT provider adapter implements.
//
// The whole point of this file is consistency: the UI only ever talks to a
// `TTSProvider`, never to ElevenLabs or 60db directly. Settings are kept in a
// single normalized 0..1 form here, and each adapter scales them to whatever
// range its own API expects (ElevenLabs uses 0..1, 60db uses 0..100).

export type ProviderId = "elevenlabs" | "60db";

export type OutputFormat = "mp3" | "wav" | "ogg" | "flac";

/** Normalized voice settings shared across providers. */
export interface VoiceSettings {
  /** 0..1 — lower is more expressive/variable. */
  stability: number;
  /** 0..1 — adherence to the original voice. */
  similarity: number;
  /** 0.5..2 — playback/synthesis speed. Ignored by ElevenLabs. */
  speed: number;
  /** Audio enhancement. 60db only; ignored by ElevenLabs. */
  enhance: boolean;
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity: 0.75,
  speed: 1,
  enhance: true,
};

export interface Voice {
  id: string;
  name: string;
  description?: string;
  language?: string;
  gender?: string;
  accent?: string;
}

export interface SynthesizeRequest {
  text: string;
  voiceId: string;
  settings: VoiceSettings;
  outputFormat: OutputFormat;
}

/** Result of a one-shot (non-streaming) synthesis. */
export interface SynthesisResult {
  /** Object URL suitable for an <audio> element. Caller must revoke it. */
  url: string;
  blob: Blob;
}

export interface StreamCallbacks {
  /** Fired as each audio chunk arrives. */
  onChunk?: (info: { index: number; bytes: number }) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
}

export interface WebSocketCallbacks {
  onOpen?: () => void;
  /** Fired with raw decoded audio bytes for each chunk. */
  onAudio?: (chunk: Uint8Array) => void;
  onFlushComplete?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
}

/** A live WebSocket synthesis session (context-based, see 60db ws docs). */
export interface WebSocketSession {
  /** Append text to the current context buffer. */
  sendText: (text: string) => void;
  /** Trigger synthesis of buffered text; audio arrives via onAudio. */
  flush: () => void;
  /** Final flush + close the context and socket. */
  close: () => void;
}

export interface TranscribeRequest {
  file: File | Blob;
  /** ISO 639-1 code, or "auto" / undefined for auto-detection. */
  language?: string;
  diarize?: boolean;
}

export interface TranscriptResult {
  text: string;
  language?: string;
  languageName?: string;
  durationSec?: number;
  raw: unknown;
}

export interface ProviderCapabilities {
  synthesize: boolean;
  httpStream: boolean;
  webSocket: boolean;
  listVoices: boolean;
  stt: boolean;
}

export interface TTSProvider {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;
  defaultVoiceId: string;
  /** True when an API key is configured for this provider. */
  isConfigured: () => boolean;

  /** One-shot synthesis -> playable blob. */
  synthesize: (req: SynthesizeRequest, signal?: AbortSignal) => Promise<SynthesisResult>;

  /** HTTP streaming. Reports chunks via callbacks and resolves to the full blob. */
  stream?: (
    req: SynthesizeRequest,
    cb: StreamCallbacks,
    signal?: AbortSignal,
  ) => Promise<SynthesisResult>;

  /** Open a WebSocket synthesis session. */
  openWebSocket?: (req: SynthesizeRequest, cb: WebSocketCallbacks) => WebSocketSession;

  /** Fetch the account's available voices. */
  listVoices?: (signal?: AbortSignal) => Promise<Voice[]>;

  /** Transcribe an audio file. */
  transcribe?: (req: TranscribeRequest, signal?: AbortSignal) => Promise<TranscriptResult>;
}
