export interface StartSharingOptions {
  roomId: string;
  onEnded?: (roomId: string) => void;
}

export interface ScreenContextValue {
  roomId: string | null;
  stream: MediaStream | null;
  isSharing: boolean;
  isRequestingScreen: boolean;
  startedAt: number | null;
  shareError: string | null;
  startSharing(options: StartSharingOptions): Promise<MediaStream | null>;
  changeSource(): Promise<MediaStream | null>;
  stopSharing(): void;
}
