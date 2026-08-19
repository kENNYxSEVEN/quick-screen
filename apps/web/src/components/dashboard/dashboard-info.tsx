import { Check, Copy, Eye, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 text-sm text-zinc-400">
        <Eye className="size-3.5" aria-hidden="true" />
        <span className="font-medium tabular-nums text-zinc-100">
          {viewerCount}
        </span>
        <span className="hidden sm:inline">
          {viewerCount === 1 ? "viewer" : "viewers"}
        </span>
      </div>

      <div
        className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-white/[0.09] bg-[#0a0a0a] text-sm transition-colors hover:border-white/[0.13]"
        title={copyLabel}
      >
        <button
          type="button"
          onClick={() => void copyLink()}
          className="group/link flex h-full min-w-0 flex-1 items-center gap-2.5 px-3 text-left outline-none transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04]"
          aria-label={copyLabel}
        >
          <Link2
            className={cn(
              "size-3.5 shrink-0 text-zinc-400 transition-colors group-hover/link:text-zinc-400",
              copyStatus === "copied" && "text-emerald-400",
            )}
            aria-hidden="true"
          />

          <span
            className={cn(
              "truncate font-mono text-xs text-zinc-300 transition-colors group-hover/link:text-zinc-100",
              copyStatus === "copied" && "text-emerald-300",
              copyStatus === "failed" && "text-red-300",
            )}
          >
            {copyStatus === "copied" ? "Copied" : roomUrl}
          </span>
        </button>

        <div className="h-4 w-px shrink-0 bg-white/[0.08]" aria-hidden="true" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void copyLink()}
          className="h-9 w-10 shrink-0 rounded-none text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
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
