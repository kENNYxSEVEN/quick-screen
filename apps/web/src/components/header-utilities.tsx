import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const FALLBACK_APP_VERSION = "0.1.0";

function getAppVersion() {
  const configuredVersion = import.meta.env.VITE_APP_VERSION?.trim();
  const version = configuredVersion || FALLBACK_APP_VERSION;

  return version.startsWith("v") ? version : `v${version}`;
}

interface HeaderUtilitiesProps {
  className?: string;
}

export function HeaderUtilities({ className }: HeaderUtilitiesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const appVersion = getAppVersion();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const root = rootRef.current;

      if (
        root &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      className={cn("ml-auto flex shrink-0 items-center gap-2.5", className)}
    >
      <span
        className="select-none font-mono text-[12px] font-medium tabular-nums text-zinc-500"
        title={`QUICK SCREEN ${appVersion}`}
      >
        {appVersion}
      </span>

      <div ref={rootRef} className="relative">
        <button
          type="button"
          className={cn(
            "flex size-[34px] items-center justify-center rounded-lg border text-[13px] font-semibold transition-colors outline-none",
            "border-white/[0.07] bg-white/[0.025] text-zinc-500",
            "hover:border-white/[0.11] hover:bg-white/[0.05] hover:text-zinc-300",
            "focus-visible:border-white/[0.18] focus-visible:ring-2 focus-visible:ring-white/[0.07]",
            isOpen && "border-white/[0.11] bg-white/[0.055] text-zinc-300",
          )}
          aria-label="Quick Screen help"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          ?
        </button>

        {isOpen && (
          <div
            role="dialog"
            aria-label="Help"
            className="absolute right-0 top-[calc(100%+10px)] z-50 w-[310px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#141414] shadow-[0_18px_55px_rgba(0,0,0,0.38)]"
          >
            <div className="border-b border-white/[0.07] px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[14px] font-medium text-zinc-200">
                  QUICK SCREEN
                </p>
                <span className="font-mono text-[12px] text-zinc-500">
                  {appVersion}
                </span>
              </div>

              <p className="mt-2 text-sm leading-5 text-zinc-400">
                Share your screen with just a link.
              </p>
            </div>

            <div className="px-6 py-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                Viewer shortcuts
              </p>

              <div className="mt-2.5 grid gap-2">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-zinc-400">Fullscreen</span>
                  <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-white/[0.08] bg-[#0a0a0a] px-1.5 font-mono text-[12px] font-medium text-zinc-300">
                    F
                  </kbd>
                </div>

                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-zinc-400">Mute / unmute</span>
                  <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-white/[0.08] bg-[#0a0a0a] px-1.5 font-mono text-[12px] font-medium text-zinc-300">
                    M
                  </kbd>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}