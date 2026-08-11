import { Radio } from "lucide-react";

import { ViewerPlayer } from "@/components/viewer/viewer-player";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useViewerMedia } from "@/hooks/use-viewer-media";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import type { Room } from "@/lib/api";

interface ViewerProps {
  room: Room;
  isEnded: boolean;
}

const stateBadgeStyles = {
  waiting: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  connecting: "border-sky-300/20 bg-sky-300/10 text-sky-200",
  watching: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  disconnected: "border-red-300/20 bg-red-300/10 text-red-200",
};

const stateLabels = {
  waiting: "Waiting",
  connecting: "Connecting",
  watching: "Live",
  disconnected: "Disconnected",
};

export function Viewer({ room, isEnded }: ViewerProps) {
  const { state, stream } = useViewerMedia(room.id, room.status, isEnded);

  return (
    <DashboardLayout>
      <Card className="gap-0 bg-white/[0.03] p-3 ring-white/10 sm:p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={`h-8 gap-1.5 px-2.5 ${stateBadgeStyles[state]}`}
          >
            <span className="relative flex size-2" aria-hidden="true">
              {state === "connecting" && (
                <span className="absolute inline-flex size-2 animate-ping rounded-full bg-sky-300 opacity-50" />
              )}
              <span
                className={`relative inline-flex size-2 rounded-full ${
                  state === "waiting"
                    ? "bg-amber-300"
                    : state === "connecting"
                      ? "bg-sky-300"
                      : "bg-red-300"
                }`}
              />
            </span>
            <Radio className="size-3.5" aria-hidden="true" />
            {stateLabels[state]}
          </Badge>

          <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-2.5 text-sm text-zinc-400">
            <span className="text-zinc-600">Room</span>
            <span className="truncate font-mono text-xs text-zinc-200">
              {room.id}
            </span>
          </div>
        </div>
      </Card>

      <ViewerPlayer
        state={state}
        stream={stream}
        isRoomEnded={isEnded}
        isStreamPaused={room.streamPaused}
      />
    </DashboardLayout>
  );
}
