import {
  CircleAlert,
  CirclePlay,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { usePlayerControls } from "@/hooks/use-player-controls";
import { isEditableKeyboardTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { ViewerConnectionState } from "@/types/viewer";

interface ViewerPlayerProps {
  state: ViewerConnectionState;
  stream: MediaStream | null;
  isRoomEnded: boolean;
  isStreamPaused: boolean;
}

interface ViewerStateDetails {
  icon: LucideIcon;
  title: string;
  description: string;
}

const viewerStateDetails: Record<ViewerConnectionState, ViewerStateDetails> = {
  waiting: {
    icon: MonitorUp,
    title: "Waiting for the host",
    description:
      "Keep this page open. The stream will appear automatically when sharing starts.",
  },
  connecting: {
    icon: LoaderCircle,
    title: "Connecting",
    description: "Establishing the viewing connection. This should only take a moment.",
  },
  watching: {
    icon: CirclePlay,
    title: "Stream connected",
    description: "The shared screen will be displayed here.",
  },
  disconnected: {
    icon: CircleAlert,
    title: "Stream unavailable",
    description: "The host may have stopped sharing or the connection was interrupted.",
  },
};

const VIEWER_VOLUME_STORAGE_KEY = "quick-screen:viewer-volume";
const DEFAULT_VIEWER_VOLUME = 1;

function getStoredViewerVolume() {
  if (typeof window === "undefined") {
    return DEFAULT_VIEWER_VOLUME;
  }

  try {
    const storedValue = window.localStorage.getItem(VIEWER_VOLUME_STORAGE_KEY);

    if (storedValue === null) {
      return DEFAULT_VIEWER_VOLUME;
    }

    const parsedVolume = Number(storedValue);

    if (Number.isFinite(parsedVolume) && parsedVolume >= 0 && parsedVolume <= 1) {
      return parsedVolume;
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return DEFAULT_VIEWER_VOLUME;
}

function storeViewerVolume(volume: number) {
  try {
    window.localStorage.setItem(VIEWER_VOLUME_STORAGE_KEY, String(volume));
  } catch {
    // Volume persistence is optional.
  }
}

function isAutoplayBlocked(error: unknown) {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function ViewerPlayer({
  state,
  stream,
  isRoomEnded,
  isStreamPaused,
}: ViewerPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(getStoredViewerVolume);
  const [isMuted, setIsMuted] = useState(false);
  const volumeRef = useRef(volume);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : DEFAULT_VIEWER_VOLUME);
  const { icon: Icon, title, description } = isRoomEnded
    ? {
      icon: CircleAlert,
      title: "Session ended",
      description: "The host ended this sharing session.",
    }
    : viewerStateDetails[state];
  const isConnecting = state === "connecting";
  const isWatching = stream !== null && state === "watching";
  const hasAudio = stream?.getAudioTracks().some((track) => track.readyState === "live") ?? false;
  const {
    containerRef,
    isFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(isWatching);
  const {
    controlsRef,
    areControlsVisible,
    showControls,
    beginControlsInteraction,
    endControlsInteraction,
    handleControlsBlur,
  } = usePlayerControls(isWatching, isFullscreen);

  useEffect(() => {
    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    videoElement.srcObject = stream;
    videoElement.volume = volumeRef.current;
    videoElement.muted = volumeRef.current === 0;
    setIsMuted(videoElement.muted);

    function handleVolumeChange(event: Event) {
      if (!(event.currentTarget instanceof HTMLVideoElement)) {
        return;
      }

      const nextVolume = event.currentTarget.volume;

      volumeRef.current = nextVolume;
      setVolume(nextVolume);
      setIsMuted(event.currentTarget.muted || nextVolume === 0);
      storeViewerVolume(nextVolume);

      if (nextVolume > 0) {
        lastAudibleVolumeRef.current = nextVolume;
      }
    }

    videoElement.addEventListener("volumechange", handleVolumeChange);

    if (!stream) {
      return () => {
        videoElement.removeEventListener("volumechange", handleVolumeChange);
      };
    }

    const hasAudio = stream.getAudioTracks().some((track) => track.readyState === "live");
    let isDisposed = false;

    if (import.meta.env.DEV) {
      console.info("[webrtc] viewer video element stream assigned", {
        streamId: stream.id,
        videoTracks: stream.getVideoTracks().map((track) => ({
          id: track.id,
          muted: track.muted,
          readyState: track.readyState,
        })),
        audioTracks: stream.getAudioTracks().map((track) => ({
          id: track.id,
          muted: track.muted,
          readyState: track.readyState,
        })),
      });
    }

    void (async () => {
      try {
        await videoElement.play();
      } catch (error) {
        if (!isAutoplayBlocked(error)) {
          if (import.meta.env.DEV) {
            console.warn("[webrtc] viewer video element could not start playback", error);
          }

          return;
        }

        videoElement.muted = true;

        try {
          await videoElement.play();
          if (!isDisposed) {
            setIsMuted(hasAudio);
          }
        } catch (mutedPlaybackError) {
          if (import.meta.env.DEV) {
            console.warn(
              "[webrtc] viewer muted video playback could not start",
              mutedPlaybackError,
            );
          }
        }
      }
    })();

    return () => {
      isDisposed = true;
      videoElement.removeEventListener("volumechange", handleVolumeChange);
    };
  }, [stream]);

  const toggleSound = useCallback(async () => {
    const video = videoRef.current;

    if (!video || !hasAudio) {
      return;
    }

    const shouldMute = !video.muted && video.volume > 0;

    if (shouldMute) {
      video.muted = true;
      setIsMuted(true);

      return;
    }

    if (video.volume === 0) {
      video.volume = lastAudibleVolumeRef.current;
    }

    video.muted = false;

    try {
      await video.play();
      setIsMuted(false);
    } catch (error) {
      video.muted = true;
      setIsMuted(true);

      if (import.meta.env.DEV) {
        console.warn("[webrtc] viewer could not enable sound", error);
      }
    }
  }, [hasAudio]);

  const handleVolumeChange = useCallback(async (nextVolumePercent: number) => {
    const video = videoRef.current;

    if (!video || !hasAudio) {
      return;
    }

    const nextVolume = Math.min(1, Math.max(0, nextVolumePercent / 100));

    volumeRef.current = nextVolume;
    setVolume(nextVolume);
    storeViewerVolume(nextVolume);
    video.volume = nextVolume;

    if (nextVolume === 0) {
      video.muted = true;
      setIsMuted(true);
      return;
    }

    lastAudibleVolumeRef.current = nextVolume;
    video.muted = false;

    try {
      await video.play();
      setIsMuted(false);
    } catch (error) {
      video.muted = true;
      setIsMuted(true);

      if (import.meta.env.DEV) {
        console.warn("[webrtc] viewer could not change volume", error);
      }
    }
  }, [hasAudio]);

  useEffect(() => {
    if (!isWatching || !hasAudio) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        isEditableKeyboardTarget(event.target) ||
        event.code !== "KeyM"
      ) {
        return;
      }

      event.preventDefault();
      void toggleSound();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hasAudio, isWatching, toggleSound]);

  if (stream && state === "watching") {
    return (
      <Card className="min-w-0 gap-0 overflow-hidden bg-black/25 p-0 ring-white/10">
        <div className="relative w-full overflow-hidden bg-black">
          <div className="w-full pb-[56.25%]" aria-hidden="true" />

          <div
            ref={containerRef}
            className={cn(
              "absolute inset-0 overflow-hidden bg-black",
              isFullscreen && "fixed inset-0 h-screen w-screen",
              !areControlsVisible && "cursor-none",
            )}
            onPointerEnter={showControls}
            onPointerMove={showControls}
            onDoubleClick={() => void toggleFullscreen()}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="absolute inset-0 block h-full w-full max-w-none bg-black object-contain"
              aria-label="Shared screen"
            />

            {isStreamPaused && (
              <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-black/55 px-6 text-center backdrop-blur-[1px]">
                <div>
                  <p className="text-lg font-semibold text-white">Stream paused</p>
                  <p className="mt-1 text-sm text-zinc-300">The host has paused sharing.</p>
                </div>
              </div>
            )}

            <div
              ref={controlsRef}
              className={cn(
                "absolute bottom-5 right-4 z-10 flex items-center gap-1 transition-opacity duration-200 sm:bottom-5 sm:right-5",
                areControlsVisible
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              onPointerEnter={beginControlsInteraction}
              onPointerLeave={endControlsInteraction}
              onFocusCapture={beginControlsInteraction}
              onBlurCapture={handleControlsBlur}
            >
              {hasAudio && (
                <div
                  className="group flex h-9 shrink-0 items-stretch"
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <div
                    className={cn(
                      "pointer-events-none w-0 overflow-hidden opacity-0",
                      "transition-[width,opacity] duration-200 ease-out",
                      "group-hover:pointer-events-auto group-hover:w-24 group-hover:opacity-100",
                      "group-focus-within:pointer-events-auto group-focus-within:w-24 group-focus-within:opacity-100",
                    )}
                  >
                    <div className="flex h-9 w-24 items-center rounded-l-md border border-r-0 border-white/15 bg-black/65 px-3 shadow-lg backdrop-blur-sm">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(volume * 100)}
                        onChange={(event) =>
                          void handleVolumeChange(Number(event.currentTarget.value))
                        }
                        className="h-1 w-full cursor-pointer accent-white"
                        aria-label="Viewer volume"
                        aria-valuetext={`${Math.round(volume * 100)}%`}
                        title={`Volume: ${Math.round(volume * 100)}%`}
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    onClick={() => void toggleSound()}
                    className={cn(
                      "relative z-10 shrink-0 border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-sm hover:bg-black/80",
                      "transition-[border-radius,background-color] duration-200 ease-out",
                      "group-hover:rounded-l-none group-focus-within:rounded-l-none",
                    )}
                    aria-label={isMuted ? "Enable sound (M)" : "Mute sound (M)"}
                    title={isMuted ? "Enable sound (M)" : "Mute sound (M)"}
                  >
                    {isMuted ? (
                      <VolumeX className="size-4" aria-hidden="true" />
                    ) : (
                      <Volume2 className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              )}

              {isFullscreenSupported && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={() => void toggleFullscreen()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-sm hover:bg-black/80"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  title={`${isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} (F)`}
                >
                  {isFullscreen ? (
                    <Minimize2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="size-4" aria-hidden="true" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 gap-0 overflow-hidden bg-black/25 p-0 ring-white/10">
      <div className="relative w-full overflow-hidden bg-zinc-950">
        <div className="w-full pb-[56.25%]" aria-hidden="true" />

        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.035),transparent_55%)]"
            aria-hidden="true"
          />

          <div className="relative z-10 max-w-sm" aria-live="polite">
            <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-300">
              <Icon
                className={isConnecting ? "size-5 animate-spin" : "size-5"}
                aria-hidden="true"
              />
            </span>

            <h1 className="mt-4 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {title}
            </h1>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {description}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}