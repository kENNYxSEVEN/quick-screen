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

type DisplayMediaOptionsWithAudioPreferences = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  windowAudio?: "system" | "window" | "exclude";
};

const DISPLAY_MEDIA_OPTIONS: DisplayMediaOptionsWithAudioPreferences = {
  video: true,
  audio: true,
  systemAudio: "include",
  windowAudio: "window",
};

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

function isScreenPickerCancellation(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

function getScreenCaptureErrorMessage(
  error: unknown,
  action: "start" | "change",
) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError":
        return "No screen, window, or browser tab is available to share.";

      case "NotReadableError":
        return action === "start"
          ? "The selected screen could not be captured. Please try another source."
          : "The selected source could not be captured. Your current stream is unchanged.";

      case "InvalidStateError":
        return "Screen sharing could not start from the current browser state. Please try again.";

      case "OverconstrainedError":
        return "The selected source does not support the requested capture settings.";
    }
  }

  return action === "start"
    ? "Screen sharing could not be started. Please try again."
    : "The screen source could not be changed. Your current stream is unchanged.";
}

export function ScreenProvider({ children }: PropsWithChildren) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRequestingScreen, setIsRequestingScreen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
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
    const pendingStream = pendingStreamRef.current;

    pendingStreamRef.current = null;
    pendingStream?.getTracks().forEach((track) => track.stop());

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

      const mediaStream = await navigator.mediaDevices.getDisplayMedia(
        DISPLAY_MEDIA_OPTIONS,
      );
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
    } catch (error) {
      if (isScreenPickerCancellation(error)) {
        // Closing/denying the native picker is treated as a user cancellation,
        // not as an application error.
        setShareError(null);

        if (import.meta.env.DEV) {
          console.info("[screen] screen picker dismissed", {
            errorName: error instanceof DOMException ? error.name : undefined,
          });
        }

        return null;
      }

      setShareError(getScreenCaptureErrorMessage(error, "start"));

      if (import.meta.env.DEV) {
        console.warn("[screen] screen capture could not be started", error);
      }

      return null;
    } finally {
      isRequestingScreenRef.current = false;
      setIsRequestingScreen(false);
    }
  }, [clearSession]);

  const changeSource = useCallback(async (): Promise<MediaStream | null> => {
    const previousStream = activeStreamRef.current;

    if (
      isRequestingScreenRef.current ||
      pendingStreamRef.current ||
      !previousStream
    ) {
      return null;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShareError("Screen sharing is not available in this browser.");
      return null;
    }

    const currentRoomId = activeRoomIdRef.current;

    if (!currentRoomId) {
      return null;
    }

    isRequestingScreenRef.current = true;
    setIsRequestingScreen(true);

    try {
      setShareError(null);

      const nextStream = await navigator.mediaDevices.getDisplayMedia(
        DISPLAY_MEDIA_OPTIONS,
      );
      await applyStoredVideoSettings(nextStream);

      // The existing capture may have ended while the picker was open.
      // In that case the candidate no longer belongs to an active session.
      if (
        activeStreamRef.current !== previousStream ||
        activeRoomIdRef.current !== currentRoomId
      ) {
        nextStream.getTracks().forEach((track) => track.stop());

        return null;
      }

      if (nextStream.getVideoTracks()[0]?.readyState !== "live") {
        nextStream.getTracks().forEach((track) => track.stop());
        setShareError(
          "The selected source ended before it could replace your current stream.",
        );

        return null;
      }

      // Important: do NOT touch the current capture yet. The caller first
      // switches the WebRTC publisher and only then calls commitSource().
      pendingStreamRef.current = nextStream;

      return nextStream;
    } catch (error) {
      if (isScreenPickerCancellation(error)) {
        // Keep the existing stream untouched when the source picker is closed.
        setShareError(null);

        if (import.meta.env.DEV) {
          console.info("[screen] source picker dismissed", {
            errorName: error instanceof DOMException ? error.name : undefined,
          });
        }

        return null;
      }

      setShareError(getScreenCaptureErrorMessage(error, "change"));

      if (import.meta.env.DEV) {
        console.warn("[screen] screen source could not be changed", error);
      }

      return null;
    } finally {
      isRequestingScreenRef.current = false;
      setIsRequestingScreen(false);
    }
  }, []);

  const commitSource = useCallback(
    (nextStream: MediaStream) => {
      if (pendingStreamRef.current !== nextStream) {
        throw new Error("The selected screen source is no longer pending.");
      }

      const previousStream = activeStreamRef.current;
      const currentRoomId = activeRoomIdRef.current;

      if (!previousStream || !currentRoomId) {
        pendingStreamRef.current = null;
        nextStream.getTracks().forEach((track) => track.stop());
        throw new Error("The previous screen source is no longer active.");
      }

      if (nextStream.getVideoTracks()[0]?.readyState !== "live") {
        pendingStreamRef.current = null;
        nextStream.getTracks().forEach((track) => track.stop());
        throw new Error("The selected screen source ended before it could be committed.");
      }

      attachEndedListener(
        nextStream,
        currentRoomId,
        intentionallyStoppedStreamsRef.current,
        clearSession,
        activeOnSystemEndedRef.current,
      );

      pendingStreamRef.current = null;
      activeStreamRef.current = nextStream;
      setStream(nextStream);

      // Only after the candidate has become the active screen source do we
      // intentionally stop the previous capture.
      intentionallyStoppedStreamsRef.current.add(previousStream);
      previousStream.getTracks().forEach((track) => track.stop());
      setShareError(null);
    },
    [clearSession],
  );

  const discardSource = useCallback((candidateStream: MediaStream) => {
    if (pendingStreamRef.current === candidateStream) {
      pendingStreamRef.current = null;
    }

    candidateStream.getTracks().forEach((track) => track.stop());
  }, []);

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
      commitSource,
      discardSource,
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
      commitSource,
      discardSource,
      stopSharing,
    ],
  );

  return (
    <ScreenContext.Provider value={value}>
      {children}
    </ScreenContext.Provider>
  );
}