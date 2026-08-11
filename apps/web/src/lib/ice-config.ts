const STUN_URL_PATTERN = /^stuns?:[^\s]+$/i;

export function parseStunUrls(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(
    value
      .split(",")
      .map((url) => url.trim())
      .filter((url) => STUN_URL_PATTERN.test(url)),
  )];
}

export function createIceConfiguration(stunUrls: string[]): RTCConfiguration {
  if (stunUrls.length === 0) {
    return { iceServers: [] };
  }

  return {
    iceServers: [{ urls: stunUrls }],
  };
}

export const browserIceConfiguration = createIceConfiguration(
  parseStunUrls(import.meta.env.VITE_STUN_URLS),
);
