// Browser audio helpers shared by the provider adapters.

/** Decode a base64 string into raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Build a Blob (+ object URL) from base64 audio for a given output format. */
export function base64ToAudioBlob(base64: string, format: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mimeForFormat(format) });
}

/** Concatenate multiple byte chunks into one Blob. */
export function bytesToBlob(chunks: Uint8Array[], format: string): Blob {
  return new Blob(chunks as BlobPart[], { type: mimeForFormat(format) });
}

export function mimeForFormat(format: string): string {
  switch (format) {
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}

/**
 * Streaming PCM player for the WebSocket API (LINEAR16 / 16-bit signed mono).
 * Decodes each chunk to Float32 and schedules it on the Web Audio clock so
 * chunks play back-to-back with no gaps — true low-latency streaming.
 */
export class PCMStreamPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private readonly sampleRate: number;

  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();
  }

  /** Push a chunk of raw 16-bit little-endian PCM bytes. */
  push(pcmBytes: Uint8Array) {
    if (pcmBytes.byteLength === 0) return;
    // Ensure even length for Int16 view.
    const usable = pcmBytes.byteLength - (pcmBytes.byteLength % 2);
    const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, usable);
    const sampleCount = usable / 2;
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = this.ctx.createBuffer(1, sampleCount, this.sampleRate);
    buffer.copyToChannel(float32, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const startAt = Math.max(this.ctx.currentTime + 0.02, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  async close() {
    // Let any scheduled audio finish before tearing down.
    const remaining = Math.max(0, this.nextStartTime - this.ctx.currentTime);
    await new Promise((r) => setTimeout(r, remaining * 1000 + 100));
    await this.ctx.close();
  }
}
