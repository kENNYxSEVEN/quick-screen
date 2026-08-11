import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { getMaxBitrate, getStoredStreamSettings } from "@/lib/stream-settings";
import { createPublisher, type PublisherConnection } from "@/lib/webrtc";
import { MediaContext } from "@/providers/media-context";

export function MediaProvider({ children }: PropsWithChildren) {
  const [isPublishing, setIsPublishing] = useState(false);
  const publisherRef = useRef<PublisherConnection | null>(null);

  const closePublisher = useCallback(() => {
    publisherRef.current?.close();
    publisherRef.current = null;
    setIsPublishing(false);
  }, []);

  const publish = useCallback(async (roomId: string, stream: MediaStream) => {
    closePublisher();
    setIsPublishing(true);

    try {
      const publisher = await createPublisher(roomId, stream);
      publisherRef.current = publisher;

      const maxBitrate = getMaxBitrate(getStoredStreamSettings());

      if (maxBitrate !== null) {
        try {
          await publisher.setBitrate(maxBitrate);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn("[webrtc] host saved bitrate could not be applied", error);
          }
        }
      }
    } finally {
      setIsPublishing(false);
    }
  }, [closePublisher]);

  const replacePublisherTrack = useCallback(async (stream: MediaStream) => {
    const publisher = publisherRef.current;

    if (!publisher) {
      throw new Error("No active publisher connection is available.");
    }

    await publisher.replaceTracks(stream);
  }, []);

  const setPublisherBitrate = useCallback(async (maxBitrate: number | null) => {
    const publisher = publisherRef.current;

    if (!publisher) {
      throw new Error("No active publisher connection is available.");
    }

    await publisher.setBitrate(maxBitrate);
  }, []);

  const setPublisherPaused = useCallback(async (paused: boolean) => {
    const publisher = publisherRef.current;

    if (!publisher) {
      throw new Error("No active publisher connection is available.");
    }

    await publisher.setPaused(paused);
  }, []);

  useEffect(() => closePublisher, [closePublisher]);

  const value = useMemo(
    () => ({
      closePublisher,
      isPublishing,
      publish,
      replacePublisherTrack,
      setPublisherPaused,
      setPublisherBitrate,
    }),
    [
      closePublisher,
      isPublishing,
      publish,
      replacePublisherTrack,
      setPublisherBitrate,
      setPublisherPaused,
    ],
  );

  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>;
}
