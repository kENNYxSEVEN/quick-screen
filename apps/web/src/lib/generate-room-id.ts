const ADJECTIVES = [
  "amber",
  "bright",
  "calm",
  "clear",
  "cool",
  "fast",
  "quiet",
  "silver",
  "soft",
  "swift",
] as const;

const NOUNS = [
  "comet",
  "falcon",
  "fox",
  "harbor",
  "orbit",
  "pixel",
  "river",
  "signal",
  "wave",
  "wolf",
] as const;

function randomIndex(length: number) {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % length;
  }

  return Math.floor(Math.random() * length);
}

function randomNumber() {
  return 100 + randomIndex(900);
}

export function generateRoomId() {
  const adjective = ADJECTIVES[randomIndex(ADJECTIVES.length)];
  const noun = NOUNS[randomIndex(NOUNS.length)];

  return `${adjective}-${noun}-${randomNumber()}`;
}

export function normalizeRoomId(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function isValidRoomId(value: string) {
  return /^[a-z0-9-]{3,48}$/.test(value);
}
