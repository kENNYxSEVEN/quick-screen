import type {
  StreamBitrate,
  StreamFrameRate,
  StreamQuality,
  StreamSettings,
} from "@/types/stream-settings";

const STORAGE_KEY = "ingamers.stream-settings";

export const defaultStreamSettings: StreamSettings = {
  quality: "auto",
  frameRate: "auto",
  bitrate: "auto",
};

const qualityValues: readonly StreamQuality[] = [
  "auto",
  "720p",
  "1080p",
  "1440p",
];
const frameRateValues: readonly StreamFrameRate[] = ["auto", 30, 60];
const bitrateValues: readonly StreamBitrate[] = ["auto", 3, 6, 10, 15];

const qualityDimensions: Record<Exclude<StreamQuality, "auto">, {
  width: number;
  height: number;
}> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
};

function isStreamSettings(value: unknown): value is StreamSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<StreamSettings>;

  return (
    qualityValues.includes(settings.quality as StreamQuality) &&
    frameRateValues.includes(settings.frameRate as StreamFrameRate) &&
    bitrateValues.includes(settings.bitrate as StreamBitrate)
  );
}

export function getStoredStreamSettings(): StreamSettings {
  if (typeof window === "undefined") {
    return defaultStreamSettings;
  }

  try {
    const storedSettings = window.localStorage.getItem(STORAGE_KEY);

    if (!storedSettings) {
      return defaultStreamSettings;
    }

    const parsedSettings: unknown = JSON.parse(storedSettings);

    return isStreamSettings(parsedSettings)
      ? parsedSettings
      : defaultStreamSettings;
  } catch {
    return defaultStreamSettings;
  }
}

export function storeStreamSettings(settings: StreamSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing contexts. The current
    // in-memory selection remains usable for the rest of the session.
  }
}

export function getVideoTrackConstraints(
  settings: StreamSettings,
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {};

  if (settings.quality !== "auto") {
    const dimensions = qualityDimensions[settings.quality];
    constraints.width = { ideal: dimensions.width };
    constraints.height = { ideal: dimensions.height };
  }

  if (settings.frameRate !== "auto") {
    constraints.frameRate = { ideal: settings.frameRate };
  }

  return constraints;
}

export async function applyVideoTrackSettings(
  stream: MediaStream,
  settings: StreamSettings,
) {
  const videoTrack = stream.getVideoTracks()[0];

  if (!videoTrack) {
    throw new Error("The selected screen does not contain a video track.");
  }

  // applyConstraints replaces prior application constraints. Supplying an
  // empty object for Auto returns width, height, and frame rate to browser
  // defaults without interrupting the captured source.
  await videoTrack.applyConstraints(getVideoTrackConstraints(settings));
}

export function getMaxBitrate(settings: StreamSettings): number | null {
  return settings.bitrate === "auto" ? null : settings.bitrate * 1_000_000;
}

export function areStreamSettingsEqual(
  left: StreamSettings,
  right: StreamSettings,
) {
  return (
    left.quality === right.quality &&
    left.frameRate === right.frameRate &&
    left.bitrate === right.bitrate
  );
}
