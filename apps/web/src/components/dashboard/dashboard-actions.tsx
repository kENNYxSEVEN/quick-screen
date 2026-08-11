import { MonitorUp, Pause, Play, RefreshCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DashboardActionsProps {
  isSharing: boolean;
  isRequestingScreen: boolean;
  isEndingRoom: boolean;
  isPaused: boolean;
  isPausePending: boolean;
  onStartSharing: () => void;
  onChangeSource: () => void;
  onTogglePause: () => void;
  onStopSharing: () => void;
}

export function DashboardActions({
  isSharing,
  isRequestingScreen,
  isEndingRoom,
  isPaused,
  isPausePending,
  onStartSharing,
  onChangeSource,
  onTogglePause,
  onStopSharing,
}: DashboardActionsProps) {
  const isBusy = isRequestingScreen || isEndingRoom || isPausePending;

  if (!isSharing) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onStartSharing}
          disabled={isBusy}
          className="h-8 px-3"
        >
          <MonitorUp className="size-3.5" aria-hidden="true" />
          {isRequestingScreen ? "Opening picker" : "Select screen"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onStopSharing}
          disabled={isBusy}
          className="h-8 px-2.5"
        >
          <Square className="size-3.5" aria-hidden="true" />
          End room
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
        className="h-8 border-white/10 bg-white/[0.03] px-2.5 text-zinc-200 hover:bg-white/[0.07]"
      >
        <RefreshCw
          className={cn("size-3.5", isRequestingScreen && "animate-spin")}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">
          {isRequestingScreen ? "Opening picker" : "Change source"}
        </span>
        <span className="sm:hidden">Change</span>
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onTogglePause}
        disabled={isBusy}
        className="h-8 border-white/10 bg-white/[0.03] px-2.5 text-zinc-200 hover:bg-white/[0.07]"
      >
        {isPaused ? (
          <Play className="size-3.5" aria-hidden="true" />
        ) : (
          <Pause className="size-3.5" aria-hidden="true" />
        )}
        <span>{isPaused ? "Resume" : "Pause"}</span>
      </Button>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onStopSharing}
        disabled={isBusy}
        className="h-8 px-2.5"
      >
        <Square className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Stop sharing</span>
        <span className="sm:hidden">Stop</span>
      </Button>
    </div>
  );
}
