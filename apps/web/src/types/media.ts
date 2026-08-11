export interface MediaContextValue {
  closePublisher(): void;
  isPublishing: boolean;
  publish(roomId: string, stream: MediaStream): Promise<void>;
  replacePublisherTrack(stream: MediaStream): Promise<void>;
  setPublisherPaused(paused: boolean): Promise<void>;
  setPublisherBitrate(maxBitrate: number | null): Promise<void>;
}
