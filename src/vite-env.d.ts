/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ELEVENLABS_API_KEY?: string;
  readonly VITE_60DB_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
