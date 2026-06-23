// Provider registry — the single place the UI imports from.

import { elevenLabsProvider } from "./elevenlabs";
import { sixtyDbProvider } from "./sixtydb";
import type { ProviderId, TTSProvider } from "./types";

export const providers: Record<ProviderId, TTSProvider> = {
  elevenlabs: elevenLabsProvider,
  "60db": sixtyDbProvider,
};

export const providerList: TTSProvider[] = [elevenLabsProvider, sixtyDbProvider];

export function getProvider(id: ProviderId): TTSProvider {
  return providers[id];
}

export * from "./types";
