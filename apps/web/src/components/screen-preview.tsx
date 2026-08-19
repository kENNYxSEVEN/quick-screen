import { MonitorUp } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ScreenPreviewProps {
  stream: MediaStream | null;
  className?: string;
  isSelectingScreen?: boolean;
  onSelectScreen?: () => void;
}

export function ScreenPreview({
  stream,
  className,
  isSelectingScreen = false,
  onSelectScreen,
}: ScreenPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = stream;
  }, [stream]);

  if (!stream) {
    return (
      <div
        className={cn(
          "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-[#060606] p-6 text-center",
          className,
        )}
      >
        <div
          className="pointer-events-none absolute inset-0 border border-white/[0.025]"
          aria-hidden="true"
        />

        <div className="relative max-w-sm">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.025] text-zinc-400">
            <MonitorUp className="size-[18px]" aria-hidden="true" />
          </span>

          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-200">
              Select a screen to start
            </p>
            <p className="mt-1.5 text-xs leading-5 text-zinc-500 sm:text-[13px]">
              Choose a screen, window, or browser tab.
            </p>
          </div>

          {onSelectScreen && (
            <Button
              type="button"
              size="sm"
              onClick={onSelectScreen}
              disabled={isSelectingScreen}
              className="mt-4 h-9 rounded-lg bg-zinc-100 px-4 text-zinc-950 hover:bg-white"
            >
              <MonitorUp className="size-3.5" aria-hidden="true" />
              {isSelectingScreen ? "Opening picker" : "Select screen"}
            </Button>
          )}
        </div>

        <div
          className="pointer-events-none absolute bottom-4 left-1/2 h-px w-16 -translate-x-1/2 bg-white/[0.035]"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={cn(
        "aspect-video w-full rounded-xl bg-black object-contain",
        className,
      )}
      aria-label="Your shared screen preview"
    />
  );
}
