import { ViewerPlayer } from "@/components/viewer/viewer-player";
import { Badge } from "@/components/ui/badge";
import { useViewerMedia } from "@/hooks/use-viewer-media";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import type { Room } from "@/lib/api";

interface ViewerProps {
  room: Room;
  isEnded: boolean;
}

const stateBadgeStyles = {
  waiting: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  connecting: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  watching: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  disconnected: "border-red-400/20 bg-red-400/10 text-red-300",
};

const stateDotStyles = {
  waiting: "bg-amber-300",
  connecting: "bg-sky-300",
  watching: "bg-emerald-300",
  disconnected: "bg-red-300",
};

const stateLabels = {
  waiting: "Waiting",
  connecting: "Connecting",
  watching: "Live",
  disconnected: "Disconnected",
};

export function Viewer({ room, isEnded }: ViewerProps) {
  const { state, stream } = useViewerMedia(room.id, room.status, isEnded);
  const isPaused = state === "watching" && room.streamPaused;
  const badgeClassName = isPaused
    ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
    : stateBadgeStyles[state];
  const dotClassName = isPaused ? "bg-amber-300" : stateDotStyles[state];
  const badgeLabel = isEnded ? "Ended" : isPaused ? "Paused" : stateLabels[state];

  return (
    <DashboardLayout showGrid>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`h-9 gap-2 rounded-lg px-3 ${badgeClassName}`}
        >
          <span className="relative flex size-2" aria-hidden="true">
            {!isPaused && (state === "connecting" || state === "watching") && (
              <span
                className={`absolute inline-flex size-2 animate-ping rounded-full opacity-45 ${dotClassName}`}
              />
            )}
            <span
              className={`relative inline-flex size-2 rounded-full ${dotClassName}`}
            />
          </span>
          {badgeLabel}
        </Badge>

        <div
          className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 text-sm"
          title={room.id}
        >
          <span className="text-zinc-500">Room</span>
          <span className="max-w-[16rem] truncate font-mono text-xs font-medium text-zinc-200">
            {room.id}
          </span>
        </div>
      </div>

      <ViewerPlayer
        state={state}
        stream={stream}
        isRoomEnded={isEnded}
        isStreamPaused={room.streamPaused}
      />
    </DashboardLayout>
  );
}