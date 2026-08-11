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

async function getExistingRoomRole(roomId: string) {
  try {
    await getRoom(roomId);

    return await getRoomRole(roomId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
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
      const existingRoomRole = await getExistingRoomRole(normalizedRoomName);

      if (existingRoomRole === "host") {
        rememberRoom(normalizedRoomName);
        navigate(`/${normalizedRoomName}`);

        return;
      }

      if (existingRoomRole === "viewer") {
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
        className: "border-white/10 bg-white/[0.02] text-zinc-600",
      }
      : recentRoomState === "checking"
        ? {
          label: "Checking",
          disabled: true,
          className: "border-white/10 bg-white/[0.02] text-zinc-600",
        }
        : recentRoomState === "unavailable"
          ? {
            label: "Unavailable",
            disabled: true,
            className: "border-white/10 bg-white/[0.02] text-zinc-600",
          }
          : {
            label: "Use room",
            disabled: false,
            className: "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]",
          };

  return (
    <main className="flex min-h-svh flex-col bg-zinc-950 text-white">
            <header className="h-16 shrink-0 border-b border-white/[0.06] px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center">
          <Brand />
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 sm:py-12">
        <div className="w-full max-w-[520px]">
          <div className="mb-8 text-center sm:mb-9">
            <h1 className="text-[2rem] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[2.5rem]">
              <span className="block">Pick a name.</span>
              <span className="mt-1 block">Share the link.</span>
            </h1>
            <p className="mt-4 text-sm leading-6 text-zinc-500 sm:text-base">
              Choose a room name and start sharing.
            </p>
          </div>

          <Card className="gap-0 overflow-visible border-white/10 bg-white/[0.025] p-5 shadow-2xl shadow-black/20 sm:p-6">
            <div>
              <label
                htmlFor="room-name"
                className="text-sm font-medium text-zinc-300"
              >
                Room name
              </label>

              <div className="mt-2 flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-lg border border-white/10 bg-zinc-950/80 focus-within:border-white/20">
                  <span className="hidden border-r border-white/10 px-3 text-sm text-zinc-600 sm:block">
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
                    className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm font-medium text-white outline-none placeholder:text-zinc-700"
                    placeholder="my-room"
                    aria-invalid={roomNameError !== null}
                    aria-describedby={roomNameError ? "room-name-error" : undefined}
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 shrink-0 border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
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
                <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-zinc-600">
                  <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{roomUrl}</span>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button
                size="lg"
                className={
                  isSharing
                    ? "h-11 min-w-0 flex-1 border border-emerald-400/25 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20"
                    : "h-11 min-w-0 flex-1"
                }
                disabled={isStartPending}
                onClick={() => void handleStartSharing()}
              >
                {isSharing ? (
                  <>
                    <span className="relative flex size-4 items-center justify-center">
                      <span className="absolute size-3 animate-ping rounded-full bg-emerald-400/40" />
                      <Radio className="relative size-4 text-emerald-400" aria-hidden="true" />
                    </span>
                    Return to live session
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <MonitorUp className="size-4" aria-hidden="true" />
                    {isStartPending ? "Preparing room" : "Start sharing"}
                    {!isStartPending && <ArrowRight className="size-4" aria-hidden="true" />}
                  </>
                )}
              </Button>

              <StreamSettings
                buttonSize="icon"
                buttonClassName="size-11 border-white/10 bg-white/[0.03] text-zinc-300 shadow-none hover:bg-white/[0.07]"
              />
            </div>

            {displayError && (
              <p
                className="mt-3 text-center text-sm text-red-300"
                role="alert"
              >
                {displayError}
              </p>
            )}

            {recentRoom && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
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
                    className={`shrink-0 ${recentRoomAction.className}`}
                  >
                    {recentRoomAction.label}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <p className="mt-5 text-center text-xs text-zinc-700">
            No account required. Room names are reusable after a room ends.
          </p>
        </div>
      </section>

      <footer className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.04] px-5 text-xs text-zinc-700">
        © 2026 iNGAMERS.PRO
      </footer>
    </main>
  );
}