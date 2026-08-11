import { MonitorUp } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface ScreenPreviewProps {
  stream: MediaStream | null;
  className?: string;
}

export function ScreenPreview({ stream, className }: ScreenPreviewProps) {
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
          "flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-white/15 bg-zinc-950/60 p-6 text-center",
          className,
        )}
      >
        <div className="space-y-3">
          <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-400">
            <MonitorUp className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium text-zinc-200">No screen selected</p>
            <p className="mt-1 text-sm text-zinc-500">
              Your local preview will appear here.
            </p>
          </div>
        </div>
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
