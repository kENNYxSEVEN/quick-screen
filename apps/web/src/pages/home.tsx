import {
  ArrowRight,
  History,
  Link2,
  MonitorUp,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Brand } from "@/components/brand";
import { HeaderUtilities } from "@/components/header-utilities";
import { FloatingAlertStack } from "@/components/floating-alert-stack";
import { StreamSettings } from "@/components/stream-settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMedia } from "@/hooks/use-media";
import { useScreen } from "@/hooks/use-screen";
import {
  ApiError,
  createRoom,
  deleteRoomMedia,
  deleteRoom,
  getApiErrorMessage,
  getRoom,
  getRoomRole,
  updateRoomStatus,
} from "@/lib/api";
import {
  generateRoomId,
  isValidRoomId,
  normalizeRoomId,
} from "@/lib/generate-room-id";
import { getRecentRoom, rememberRoom } from "@/lib/recent-room";

type RecentRoomState = "checking" | "available" | "host" | "viewer" | "unavailable";

async function getExistingRoomAccess(roomId: string) {
  try {
    const room = await getRoom(roomId);
    const role = await getRoomRole(roomId);

    return { room, role };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function getExistingRoomRole(roomId: string) {
  const access = await getExistingRoomAccess(roomId);

  return access?.role ?? null;
}


function GridBackground() {
  const gridStyle = {
    backgroundImage:
      "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
    backgroundSize: "43px 43px",
    backgroundPosition: "center center",

    maskImage:
      "linear-gradient(to right, transparent 0%, black 22%, black 52%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 32%, black 80%, transparent 100%)",
    maskComposite: "intersect",

    WebkitMaskImage:
      "linear-gradient(to right, transparent 0%, black 22%, black 52%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 32%, black 80%, transparent 100%)",
    WebkitMaskComposite: "source-in",
  } as const;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-80"
        style={gridStyle}
      />
    </div>
  );
}

export function Home() {
  const navigate = useNavigate();
  const { closePublisher, publish } = useMedia();
  const [roomName, setRoomName] = useState(() => generateRoomId());
  const [roomNameError, setRoomNameError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [recentRoom] = useState(() => getRecentRoom());
  const [recentRoomState, setRecentRoomState] = useState<RecentRoomState>(
    recentRoom ? "checking" : "available",
  );
  const {
    roomId,
    isSharing,
    isRequestingScreen,
    shareError,
    startSharing,
    stopSharing,
  } = useScreen();

  const normalizedRoomName = useMemo(
    () => normalizeRoomId(roomName),
    [roomName],
  );
  const roomUrl = `${window.location.origin}/${normalizedRoomName || "room-name"}`;
  const isStartPending = isCreatingRoom || isRequestingScreen;
  const displayError = requestError ?? shareError;

  useEffect(() => {
    if (!recentRoom) {
      return;
    }

    let isDisposed = false;
    setRecentRoomState("checking");

    void getExistingRoomRole(recentRoom.roomId).then(
      (role) => {
        if (isDisposed) {
          return;
        }

        setRecentRoomState(role ?? "available");
      },
      () => {
        if (!isDisposed) {
          setRecentRoomState("unavailable");
        }
      },
    );

    return () => {
      isDisposed = true;
    };
  }, [recentRoom]);

  const handleSystemStop = useCallback((endedRoomId: string) => {
    closePublisher();
    void deleteRoomMedia(endedRoomId).catch(() => undefined);
    void updateRoomStatus(endedRoomId, "waiting").catch(() => undefined);
  }, [closePublisher]);

  function handleRoomNameChange(value: string) {
    setRoomName(normalizeRoomId(value));
    setRoomNameError(null);
    setRequestError(null);
  }

  function generateAnotherRoom() {
    setRoomName(generateRoomId());
    setRoomNameError(null);
    setRequestError(null);
  }

  function handleRecentRoomAction() {
    if (!recentRoom) {
      return;
    }

    if (recentRoomState === "host") {
      rememberRoom(recentRoom.roomId);
      navigate(`/${recentRoom.roomId}`);

      return;
    }

    if (recentRoomState !== "available") {
      return;
    }

    setRoomName(recentRoom.roomId);
    setRoomNameError(null);
    setRequestError(null);
  }

  async function endPreviousWaitingRoom(nextRoomId: string) {
    if (!recentRoom || recentRoom.roomId === nextRoomId) {
      return;
    }

    const previousRoomAccess = await getExistingRoomAccess(recentRoom.roomId);

    if (
      !previousRoomAccess ||
      previousRoomAccess.role !== "host" ||
      previousRoomAccess.room.status !== "waiting"
    ) {
      return;
    }

    await deleteRoom(recentRoom.roomId);

    if (import.meta.env.DEV) {
      console.info("[room] previous waiting room ended before starting a new room", {
        previousRoomId: recentRoom.roomId,
        nextRoomId,
      });
    }
  }

  async function removeCreatedRoom(roomIdToDelete: string) {
    try {
      await deleteRoom(roomIdToDelete);
    } catch {
      // The original request error is more actionable than cleanup failure.
    }
  }

  async function handleStartSharing() {
    if (isSharing && roomId) {
      navigate(`/${roomId}`);

      return;
    }

    if (!isValidRoomId(normalizedRoomName)) {
      setRoomNameError("Use 3-48 lowercase letters, numbers, or hyphens.");

      return;
    }

    setRequestError(null);
    setIsCreatingRoom(true);

    try {
      const existingRoomAccess = await getExistingRoomAccess(normalizedRoomName);

      if (existingRoomAccess?.role === "host") {
        rememberRoom(normalizedRoomName);
        navigate(`/${normalizedRoomName}`);

        return;
      }

      if (existingRoomAccess?.role === "viewer") {
        setRequestError("This room name is already in use.");

        return;
      }

      await createRoom(normalizedRoomName);

      const sharedStream = await startSharing({
        roomId: normalizedRoomName,
        onEnded: handleSystemStop,
      });

      if (!sharedStream) {
        await removeCreatedRoom(normalizedRoomName);

        return;
      }

      try {
        await endPreviousWaitingRoom(normalizedRoomName);
        await publish(normalizedRoomName, sharedStream);

        if (sharedStream.getVideoTracks()[0]?.readyState !== "live") {
          throw new Error("Screen sharing ended before publishing completed.");
        }

        await updateRoomStatus(normalizedRoomName, "live");
      } catch (error) {
        closePublisher();
        stopSharing();
        await deleteRoomMedia(normalizedRoomName).catch(() => undefined);
        await removeCreatedRoom(normalizedRoomName);
        throw error;
      }

      rememberRoom(normalizedRoomName);
      navigate(`/${normalizedRoomName}`);
    } catch (error) {
      setRequestError(
        getApiErrorMessage(error, "Unable to create the room. Please try again."),
      );
    } finally {
      setIsCreatingRoom(false);
    }
  }

  const recentRoomAction = recentRoomState === "host"
    ? {
      label: "Return to room",
      disabled: false,
      className: "border-emerald-400/25 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
    }
    : recentRoomState === "viewer"
      ? {
        label: "In use",
        disabled: true,
        className: "border-white/10 bg-white/[0.02] text-zinc-500",
      }
      : recentRoomState === "checking"
        ? {
          label: "Checking",
          disabled: true,
          className: "border-white/10 bg-white/[0.02] text-zinc-500",
        }
        : recentRoomState === "unavailable"
          ? {
            label: "Unavailable",
            disabled: true,
            className: "border-white/10 bg-white/[0.02] text-zinc-500",
          }
          : {
            label: "Use room",
            disabled: false,
            className: "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]",
          };

  return (
    <main className="flex min-h-svh flex-col bg-[#080808] text-white">
      <FloatingAlertStack
        alerts={
          displayError
            ? [
                {
                  id: requestError ? "home-request-error" : "screen-share-error",
                  description: displayError,
                  variant: "error",
                },
              ]
            : []
        }
      />
      <header className="h-16 shrink-0 border-b border-white/[0.055] bg-[#0d0d0d] px-5 sm:px-7 lg:px-8">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center">
          <Brand />
          <HeaderUtilities />
        </div>
      </header>

      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-10 sm:px-8 sm:py-12">
        <GridBackground />

        <div className="relative z-10 w-full max-w-[450px] sm:-translate-y-6">
          <div className="mb-8 text-center">
            <h1 className="text-[2.25rem] font-semibold leading-[0.98] tracking-[-0.045em] text-zinc-50 sm:text-[2.625rem]">
              <span className="block">Pick a name.</span>
              <span className="mt-1 block">Share the link.</span>
            </h1>
            <p className="mt-4 text-sm leading-6 text-zinc-400 sm:text-[15px]">
              Choose a room name and start sharing.
            </p>
          </div>

          <Card className="gap-0 overflow-visible rounded-xl border-white/[0.09] bg-[#121212] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.22)] sm:p-6">
            <div>
              <label
                htmlFor="room-name"
                className="text-[13px] font-medium text-zinc-300"
              >
                Room name
              </label>

              <div className="relative mt-2 flex h-12 items-center rounded-lg border border-white/[0.09] bg-[#0a0a0a] transition-colors focus-within:border-white/[0.18]">
                <span className="flex h-6 shrink-0 items-center border-r border-white/[0.07] px-3 text-sm text-zinc-500">
                  /
                </span>

                <input
                  id="room-name"
                  value={roomName}
                  onChange={(event) => handleRoomNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleStartSharing();
                    }
                  }}
                  maxLength={48}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-full min-w-0 flex-1 bg-transparent px-3 pr-11 text-sm font-medium text-zinc-100 outline-none placeholder:text-zinc-600"
                  placeholder="my-room"
                  aria-invalid={roomNameError !== null}
                  aria-describedby={roomNameError ? "room-name-error" : undefined}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 size-9 -translate-y-1/2 rounded-md text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300"
                  onClick={generateAnotherRoom}
                  aria-label="Generate another room name"
                  title="Generate another room name"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {roomNameError ? (
                <p
                  id="room-name-error"
                  className="mt-2 text-sm text-red-300"
                  role="alert"
                >
                  {roomNameError}
                </p>
              ) : (
                <div className="mt-2.5 flex min-w-0 items-center gap-2 text-xs">
                  <Link2
                    className="size-3.5 shrink-0 text-zinc-500"
                    aria-hidden="true"
                  />
                  <span className="truncate text-zinc-500">{roomUrl}</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button
                size="lg"
                className={
                  isSharing
                    ? "h-11 min-w-0 flex-1 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-4 text-emerald-200 hover:bg-emerald-500/20"
                    : "h-11 min-w-0 flex-1 rounded-lg bg-zinc-100 px-4 text-zinc-950 hover:bg-white"
                }
                disabled={isStartPending}
                onClick={() => void handleStartSharing()}
              >
                {isSharing ? (
                  <>
                    <span className="relative flex size-4 items-center justify-center">
                      <span className="absolute size-3 animate-ping rounded-full bg-emerald-400/40" />
                      <Radio
                        className="relative size-4 text-emerald-400"
                        aria-hidden="true"
                      />
                    </span>
                    Return to live session
                    <ArrowRight className="ml-auto size-4" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <MonitorUp className="size-4" aria-hidden="true" />
                    {isStartPending ? "Preparing room" : "Start sharing"}
                    {!isStartPending && (
                      <ArrowRight className="ml-auto size-4" aria-hidden="true" />
                    )}
                  </>
                )}
              </Button>

              <StreamSettings
                placement="home"
                buttonSize="icon"
                buttonClassName="size-11 rounded-lg border-white/[0.09] bg-white/[0.025] text-zinc-400 shadow-none hover:border-white/[0.13] hover:bg-white/[0.055] hover:text-zinc-200"
              />
            </div>

            {recentRoom && (
              <div className="mt-4 border-t border-white/[0.08] pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <History className="size-3.5" aria-hidden="true" />
                      <span>Your recent room</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-zinc-300">
                      {recentRoom.roomId}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRecentRoomAction}
                    disabled={recentRoomAction.disabled}
                    className={`h-8 shrink-0 rounded-lg px-3 ${recentRoomAction.className}`}
                  >
                    {recentRoomAction.label}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <p className="mt-4 text-center text-[11px] leading-5 text-zinc-500">
            No account required. Room names are reusable after a room ends.
          </p>
        </div>
      </section>

      <footer className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.04] bg-[#0d0d0d] px-5 text-[11px] text-zinc-600">
        © 2026 iNGAMERS.PRO
      </footer>
    </main>
  );
}