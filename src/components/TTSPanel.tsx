// Unified TTS/STT panel. Talks only to the shared TTSProvider interface, so the
// same controls drive ElevenLabs and 60db; capabilities the active provider
// doesn't support are simply disabled.

import { useEffect, useRef, useState } from "react";
import { PCMStreamPlayer } from "../lib/audio";
import { getProvider, providerList } from "../providers";
import {
  DEFAULT_SETTINGS,
  type OutputFormat,
  type ProviderId,
  type Voice,
  type VoiceSettings,
} from "../providers/types";

const OUTPUT_FORMATS: OutputFormat[] = ["mp3", "wav", "ogg", "flac"];

export default function TTSPanel() {
  const [providerId, setProviderId] = useState<ProviderId>("elevenlabs");
  const provider = getProvider(providerId);

  const [text, setText] = useState(
    "Hello, this is a sample text to stream as speech.",
  );
  const [voiceId, setVoiceId] = useState(provider.defaultVoiceId);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3");

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");

  const wsSessionRef = useRef<ReturnType<NonNullable<typeof provider.openWebSocket>> | null>(null);
  const pcmPlayerRef = useRef<PCMStreamPlayer | null>(null);

  // When switching providers, reset the voice to that provider's default and
  // clear any loaded voice list (keys/voice ids are not interchangeable).
  useEffect(() => {
    setVoiceId(provider.defaultVoiceId);
    setVoices([]);
    setStatus("");
    setError("");
  }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revoke object URLs when they change / on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const guardConfigured = () => {
    if (!provider.isConfigured()) {
      setError(
        `No API key configured for ${provider.label}. Add it to your .env file (see .env.example).`,
      );
      return false;
    }
    return true;
  };

  const updateSetting = <K extends keyof VoiceSettings>(
    key: K,
    value: VoiceSettings[K],
  ) => setSettings((s) => ({ ...s, [key]: value }));

  const req = () => ({ text, voiceId, settings, outputFormat });

  // --- Actions -------------------------------------------------------------

  const handleSynthesize = async () => {
    if (!guardConfigured()) return;
    setBusy(true);
    setError("");
    setStatus("Synthesizing…");
    try {
      const result = await provider.synthesize(req());
      setAudioUrl(result.url);
      setStatus("Done — playing.");
      new Audio(result.url).play();
    } catch (e) {
      setError(messageOf(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const handleHttpStream = async () => {
    if (!provider.stream || !guardConfigured()) return;
    setBusy(true);
    setError("");
    setStatus("Streaming…");
    try {
      const result = await provider.stream(req(), {
        onChunk: ({ index, bytes }) =>
          setStatus(`Received chunk ${index + 1} (${bytes} bytes)…`),
        onComplete: () => setStatus("Stream complete — playing."),
      });
      setAudioUrl(result.url);
      new Audio(result.url).play();
    } catch (e) {
      setError(messageOf(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const handleWebSocket = () => {
    if (!provider.openWebSocket || !guardConfigured()) return;
    setError("");
    setStatus("Opening WebSocket…");
    const player = new PCMStreamPlayer(24000);
    pcmPlayerRef.current = player;

    const session = provider.openWebSocket(req(), {
      onOpen: () => setStatus("WebSocket open — synthesizing…"),
      onAudio: (chunk) => {
        setStatus("Playing streamed audio…");
        player.push(chunk);
      },
      onFlushComplete: () => {
        setStatus("Flush complete.");
        session.close();
      },
      onError: (m) => setError(`WebSocket: ${m}`),
      onClose: () => {
        setStatus("WebSocket closed.");
        player.close();
        pcmPlayerRef.current = null;
        wsSessionRef.current = null;
      },
    });
    wsSessionRef.current = session;
  };

  const handleLoadVoices = async () => {
    if (!provider.listVoices || !guardConfigured()) return;
    setBusy(true);
    setError("");
    setStatus("Loading voices…");
    try {
      const list = await provider.listVoices();
      setVoices(list);
      if (list.length) setVoiceId(list[0].id);
      setStatus(`Loaded ${list.length} voices.`);
    } catch (e) {
      setError(messageOf(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  // --- Render --------------------------------------------------------------

  const caps = provider.capabilities;

  return (
    <div style={styles.panel}>
      <h2>Text-to-Speech</h2>

      <label style={styles.row}>
        <span style={styles.label}>Provider</span>
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value as ProviderId)}
        >
          {providerList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.isConfigured() ? "" : " (no key)"}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.row}>
        <span style={styles.label}>Voice</span>
        <span style={{ display: "flex", gap: 8, flex: 1 }}>
          {voices.length > 0 ? (
            <select
              style={{ flex: 1 }}
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.language ? ` · ${v.language}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              style={{ flex: 1 }}
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
            />
          )}
          {caps.listVoices && (
            <button onClick={handleLoadVoices} disabled={busy}>
              Load voices
            </button>
          )}
        </span>
      </label>

      <label style={styles.row}>
        <span style={styles.label}>Text</span>
        <textarea
          style={{ flex: 1 }}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      <fieldset style={styles.fieldset}>
        <legend>Voice settings (normalized 0–1)</legend>
        <Slider
          label="Stability"
          value={settings.stability}
          onChange={(v) => updateSetting("stability", v)}
        />
        <Slider
          label="Similarity"
          value={settings.similarity}
          onChange={(v) => updateSetting("similarity", v)}
        />
        <Slider
          label="Speed"
          min={0.5}
          max={2}
          step={0.1}
          value={settings.speed}
          onChange={(v) => updateSetting("speed", v)}
        />
        <label style={styles.row}>
          <span style={styles.label}>Enhance (60db)</span>
          <input
            type="checkbox"
            checked={settings.enhance}
            onChange={(e) => updateSetting("enhance", e.target.checked)}
          />
        </label>
        <label style={styles.row}>
          <span style={styles.label}>Output format</span>
          <select
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div style={styles.buttons}>
        <button onClick={handleSynthesize} disabled={busy || !caps.synthesize}>
          Synthesize
        </button>
        <button
          onClick={handleHttpStream}
          disabled={busy || !caps.httpStream}
          title={caps.httpStream ? "" : "Not supported by this provider"}
        >
          HTTP stream
        </button>
        <button
          onClick={handleWebSocket}
          disabled={busy || !caps.webSocket}
          title={caps.webSocket ? "" : "Not supported by this provider"}
        >
          WebSocket stream
        </button>
      </div>

      {status && <p style={{ color: "#4a9" }}>{status}</p>}
      {error && <p style={{ color: "#e55" }}>{error}</p>}
      {audioUrl && <audio controls src={audioUrl} style={{ width: "100%" }} />}

      {caps.stt && <SttSection providerId={providerId} />}
    </div>
  );
}

// --- Speech-to-text (60db only) --------------------------------------------

function SttSection({ providerId }: { providerId: ProviderId }) {
  const provider = getProvider(providerId);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("auto");
  const [diarize, setDiarize] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleTranscribe = async () => {
    if (!provider.transcribe || !file) return;
    if (!provider.isConfigured()) {
      setError(`No API key configured for ${provider.label}.`);
      return;
    }
    setBusy(true);
    setError("");
    setTranscript("");
    try {
      const result = await provider.transcribe({
        file,
        language: language === "auto" ? undefined : language,
        diarize,
      });
      setTranscript(result.text || "(no speech detected)");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset style={styles.fieldset}>
      <legend>Speech-to-Text ({provider.label})</legend>
      <input
        type="file"
        accept="audio/*,video/mp4,.webm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <label style={styles.row}>
        <span style={styles.label}>Language</span>
        <input value={language} onChange={(e) => setLanguage(e.target.value)} />
      </label>
      <label style={styles.row}>
        <span style={styles.label}>Diarize</span>
        <input
          type="checkbox"
          checked={diarize}
          onChange={(e) => setDiarize(e.target.checked)}
        />
      </label>
      <button onClick={handleTranscribe} disabled={busy || !file}>
        Transcribe
      </button>
      {error && <p style={{ color: "#e55" }}>{error}</p>}
      {transcript && (
        <p style={{ textAlign: "left", whiteSpace: "pre-wrap" }}>{transcript}</p>
      )}
    </fieldset>
  );
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label style={styles.row}>
      <span style={styles.label}>
        {label}: {value.toFixed(2)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
    </label>
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const styles: Record<string, React.CSSProperties> = {
  panel: { maxWidth: 640, margin: "0 auto", textAlign: "left" },
  row: { display: "flex", alignItems: "center", gap: 8, margin: "8px 0" },
  label: { minWidth: 130, display: "inline-block" },
  fieldset: { margin: "16px 0", border: "1px solid #444", borderRadius: 8 },
  buttons: { display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" },
};
