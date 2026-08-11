import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import {
  applyVideoTrackSettings,
  getStoredStreamSettings,
} from "@/lib/stream-settings";
import { ScreenContext } from "@/providers/screen-context";
import type { StartSharingOptions } from "@/types/screen";

function attachEndedListener(
  mediaStream: MediaStream,
  roomId: string,
  intentionallyStoppedStreams: WeakSet<MediaStream>,
  onEnded: (stream: MediaStream) => void,
  onSystemEnded: ((roomId: string) => void) | undefined,
) {
  mediaStream.getVideoTracks()[0]?.addEventListener(
    "ended",
    () => {
      const wasStoppedIntentionally = intentionallyStoppedStreams.has(mediaStream);

      onEnded(mediaStream);

      if (!wasStoppedIntentionally) {
        onSystemEnded?.(roomId);
      }
    },
    { once: true },
  );
}

async function applyStoredVideoSettings(mediaStream: MediaStream) {
  try {
    await applyVideoTrackSettings(mediaStream, getStoredStreamSettings());
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[webrtc] host saved video settings could not be applied", error);
    }
  }
}

export function ScreenProvider({ children }: PropsWithChildren) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRequestingScreen, setIsRequestingScreen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const activeOnSystemEndedRef = useRef<((roomId: string) => void) | undefined>(undefined);
  const intentionallyStoppedStreamsRef = useRef(new WeakSet<MediaStream>());
  const isRequestingScreenRef = useRef(false);

  const clearSession = useCallback((expectedStream?: MediaStream) => {
    if (expectedStream && activeStreamRef.current !== expectedStream) {
      return;
    }

    activeStreamRef.current = null;
    activeRoomIdRef.current = null;
    activeOnSystemEndedRef.current = undefined;
    setStream(null);
    setRoomId(null);
    setStartedAt(null);
  }, []);

  const stopSharing = useCallback(() => {
    const activeStream = activeStreamRef.current;

    if (activeStream) {
      intentionallyStoppedStreamsRef.current.add(activeStream);
    }

    activeStream?.getTracks().forEach((track) => track.stop());
    clearSession(activeStream ?? undefined);
    setShareError(null);
  }, [clearSession]);

  useEffect(() => {
    return stopSharing;
  }, [stopSharing]);

  const startSharing = useCallback(async (
    options: StartSharingOptions,
  ): Promise<MediaStream | null> => {
    if (isRequestingScreenRef.current || activeStreamRef.current) {
      return null;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShareError("Screen sharing is not available in this browser.");
      return null;
    }

    isRequestingScreenRef.current = true;
    setIsRequestingScreen(true);

    try {
      setShareError(null);

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      await applyStoredVideoSettings(mediaStream);
      const id = options.roomId;

      attachEndedListener(
        mediaStream,
        id,
        intentionallyStoppedStreamsRef.current,
        clearSession,
        options.onEnded,
      );

      activeStreamRef.current = mediaStream;
      activeRoomIdRef.current = id;
      activeOnSystemEndedRef.current = options.onEnded;
      setStream(mediaStream);
      setRoomId(id);
      setStartedAt(Date.now());

      return mediaStream;
    } catch {
      setShareError("Screen sharing was cancelled or could not be started.");
      return null;
    } finally {
      isRequestingScreenRef.current = false;
      setIsRequestingScreen(false);
    }
  }, [clearSession]);

  const changeSource = useCallback(async (): Promise<MediaStream | null> => {
    const previousStream = activeStreamRef.current;

    if (isRequestingScreenRef.current || !previousStream) {
      return null;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShareError("Screen sharing is not available in this browser.");
      return null;
    }

    const currentRoomId = activeRoomIdRef.current;
    const currentStartedAt = startedAt;

    if (!currentRoomId) {
      return null;
    }

    isRequestingScreenRef.current = true;
    setIsRequestingScreen(true);

    try {
      setShareError(null);

      const nextStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      await applyStoredVideoSettings(nextStream);

      attachEndedListener(
        nextStream,
        currentRoomId,
        intentionallyStoppedStreamsRef.current,
        clearSession,
        activeOnSystemEndedRef.current,
      );

      intentionallyStoppedStreamsRef.current.add(previousStream);
      activeStreamRef.current = nextStream;
      activeRoomIdRef.current = currentRoomId;
      setStream(nextStream);
      setRoomId(currentRoomId);
      setStartedAt(currentStartedAt);

      previousStream.getTracks().forEach((track) => track.stop());

      return nextStream;
    } catch {
      setShareError("Screen source change was cancelled or could not be completed.");
      return null;
    } finally {
      isRequestingScreenRef.current = false;
      setIsRequestingScreen(false);
    }
  }, [clearSession, startedAt]);

  const value = useMemo(
    () => ({
      roomId,
      stream,
      isSharing: stream !== null,
      isRequestingScreen,
      startedAt,
      shareError,
      startSharing,
      changeSource,
      stopSharing,
    }),
    [
      roomId,
      stream,
      isRequestingScreen,
      startedAt,
      shareError,
      startSharing,
      changeSource,
      stopSharing,
    ],
  );

  return (
    <ScreenContext.Provider value={value}>
      {children}
    </ScreenContext.Provider>
  );
}
