// Central place to read API keys / endpoints from Vite env vars.
//
// Create a `.env` (or `.env.local`) file at the project root — see `.env.example`.
// Only variables prefixed with VITE_ are exposed to client code by Vite.
//
// NOTE: any key referenced here is shipped to the browser. That is fine for a
// local demo, but for production you should proxy these calls through a backend
// so the keys never leave your server.

export const config = {
  elevenLabs: {
    apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY ?? "",
    baseUrl: "https://api.elevenlabs.io/v1",
    // ElevenLabs "Rachel" — the stock default used by the original example.
    defaultVoiceId: "21m00Tcm4TlvDq8ikWAM",
  },
  sixtyDb: {
    apiKey: import.meta.env.VITE_60DB_API_KEY ?? "",
    baseUrl: "https://api.60db.ai",
    // ws:// per the docs; the host has no https/wss documented, so we mirror it.
    wsUrl: "ws://api.60db.ai/ws/tts",
    // Documented default 60db voice.
    defaultVoiceId: "fbb75ed2-975a-40c7-9e06-38e30524a9a1",
  },
} as const;

export function hasKey(provider: "elevenlabs" | "60db"): boolean {
  return provider === "elevenlabs"
    ? config.elevenLabs.apiKey.length > 0
    : config.sixtyDb.apiKey.length > 0;
}
