export type StreamQuality = "auto" | "720p" | "1080p" | "1440p";
export type StreamFrameRate = "auto" | 30 | 60;
export type StreamBitrate = "auto" | 3 | 6 | 10 | 15;

export interface StreamSettings {
  quality: StreamQuality;
  frameRate: StreamFrameRate;
  bitrate: StreamBitrate;
}

export interface StreamSettingsContextValue {
  settings: StreamSettings;
  errorMessage: string | null;
  isApplying: boolean;
  updateSettings(settings: StreamSettings): Promise<boolean>;
}
