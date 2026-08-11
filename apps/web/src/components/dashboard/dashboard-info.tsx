import { Check, Copy, Eye, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface DashboardInfoProps {
  roomUrl: string;
  viewerCount: number;
}

type CopyStatus = "idle" | "copied" | "failed";

export function DashboardInfo({ roomUrl, viewerCount }: DashboardInfoProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  function showCopyStatus(status: Exclude<CopyStatus, "idle">) {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    setCopyStatus(status);
    resetTimerRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      resetTimerRef.current = null;
    }, 2_000);
  }

  async function copyLink() {
    if (!navigator.clipboard) {
      showCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(roomUrl);
      showCopyStatus("copied");
    } catch {
      showCopyStatus("failed");
    }
  }

  const copyLabel = {
    idle: "Copy room link",
    copied: "Room link copied",
    failed: "Copy unavailable",
  }[copyStatus];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.025] px-2.5 text-sm text-zinc-300">
        <Eye className="size-3.5 text-zinc-500" aria-hidden="true" />
        <span className="font-medium text-white">{viewerCount}</span>
        <span className="hidden text-zinc-500 sm:inline">viewers</span>
      </div>

      <div
        className="flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.025] text-sm text-zinc-400"
        title={roomUrl}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
          <Link2 className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
          <span className="truncate font-mono text-xs">{roomUrl}</span>
        </div>

        <div className="h-4 w-px shrink-0 bg-white/10" aria-hidden="true" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void copyLink()}
          className="h-8 w-9 shrink-0 rounded-none text-zinc-400 hover:bg-white/[0.07] hover:text-white"
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copyStatus === "copied" ? (
            <Check className="size-3.5 text-emerald-300" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>

      <span className="sr-only" aria-live="polite">
        {copyStatus === "copied" && "Room link copied to clipboard."}
        {copyStatus === "failed" && "Room link could not be copied automatically."}
      </span>
    </div>
  );
}
