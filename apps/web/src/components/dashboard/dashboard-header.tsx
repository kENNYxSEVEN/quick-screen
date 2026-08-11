import { Clock3, Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface DashboardHeaderProps {
  duration: string;
  isSharing: boolean;
  isPaused: boolean;
}

export function DashboardHeader({
  duration,
  isSharing,
  isPaused,
}: DashboardHeaderProps) {
  const sessionStatus = isPaused ? "Paused" : isSharing ? "Live" : "Ready";
  const statusClassName = isPaused
    ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
    : isSharing
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : "border-white/10 bg-white/[0.03] text-zinc-300";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Badge
        variant="outline"
        className={`h-8 gap-1.5 px-2.5 ${statusClassName}`}
      >
        <span className="relative flex size-2" aria-hidden="true">
          {isSharing && !isPaused && (
            <span className="absolute inline-flex size-2 animate-ping rounded-full bg-emerald-300 opacity-60" />
          )}
          <span
            className={`relative inline-flex size-2 rounded-full ${isPaused ? "bg-amber-300" : isSharing ? "bg-emerald-300" : "bg-zinc-400"}`}
          />
        </span>
        <Radio className="size-3.5" aria-hidden="true" />
        {sessionStatus}
      </Badge>

      <Badge
        variant="outline"
        className="h-8 gap-1.5 border-white/10 bg-white/[0.03] px-2.5 text-zinc-300"
      >
        <Clock3 className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Session duration </span>
        {duration}
      </Badge>
    </div>
  );
}
