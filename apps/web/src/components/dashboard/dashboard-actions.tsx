import { MonitorUp, Pause, Play, RefreshCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DashboardActionsProps {
  isSharing: boolean;
  isRequestingScreen: boolean;
  isPublishing: boolean;
  isChangingSource: boolean;
  isEndingRoom: boolean;
  isStoppingSharing: boolean;
  isPaused: boolean;
  isPausePending: boolean;
  onStartSharing: () => void;
  onChangeSource: () => void;
  onTogglePause: () => void;
  onStopSharing: () => void;
  onEndRoom: () => void;
}

export function DashboardActions({
  isSharing,
  isRequestingScreen,
  isPublishing,
  isChangingSource,
  isEndingRoom,
  isStoppingSharing,
  isPaused,
  isPausePending,
  onStartSharing,
  onChangeSource,
  onTogglePause,
  onStopSharing,
  onEndRoom,
}: DashboardActionsProps) {
  const isBusy =
    isRequestingScreen ||
    isPublishing ||
    isChangingSource ||
    isEndingRoom ||
    isStoppingSharing ||
    isPausePending;

  if (!isSharing) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onStartSharing}
          disabled={isBusy}
          className="h-9 rounded-lg bg-zinc-100 px-3 text-zinc-950 hover:bg-white"
        >
          <MonitorUp className="size-3.5" aria-hidden="true" />
          {isRequestingScreen
            ? "Opening picker"
            : isPublishing
              ? "Starting stream"
              : "Select screen"}
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onEndRoom}
          disabled={isBusy}
          className="h-9 rounded-lg border border-red-400/10 bg-red-400/[0.08] px-3 text-red-300 hover:bg-red-400/[0.13]"
        >
          <Square className="size-3.5" aria-hidden="true" />
          {isEndingRoom ? "Ending room" : "End room"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onChangeSource}
        disabled={isBusy}
        className="h-9 rounded-lg border-white/[0.09] bg-white/[0.025] px-3 text-zinc-300 hover:border-white/[0.13] hover:bg-white/[0.055] hover:text-zinc-100"
      >
        <RefreshCw
          className={cn(
            "size-3.5 text-zinc-400",
            (isRequestingScreen || isChangingSource) && "animate-spin",
          )}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">
          {isRequestingScreen
            ? "Opening picker"
            : isChangingSource
              ? "Switching source"
              : "Switch source"}
        </span>
        <span className="sm:hidden">
          {isChangingSource ? "Switching" : "Change"}
        </span>
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onTogglePause}
        disabled={isBusy}
        className={cn(
          "h-9 rounded-lg border-white/[0.09] bg-white/[0.025] px-3 text-zinc-300 hover:border-white/[0.13] hover:bg-white/[0.055] hover:text-zinc-100",
          isPaused &&
            "border-amber-400/15 bg-amber-400/[0.08] text-amber-200 hover:bg-amber-400/[0.12] hover:text-amber-100",
        )}
      >
        {isPaused ? (
          <Play className="size-3.5" aria-hidden="true" />
        ) : (
          <Pause className="size-3.5 text-zinc-400" aria-hidden="true" />
        )}
        <span>{isPaused ? "Resume" : "Pause"}</span>
      </Button>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onStopSharing}
        disabled={isBusy}
        className="h-9 rounded-lg border border-red-400/10 bg-red-400/[0.08] px-3 text-red-300 hover:bg-red-400/[0.13]"
      >
        <Square className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">
          {isStoppingSharing ? "Stopping" : "Stop sharing"}
        </span>
        <span className="sm:hidden">
          {isStoppingSharing ? "Stopping" : "Stop"}
        </span>
      </Button>
    </div>
  );
}
