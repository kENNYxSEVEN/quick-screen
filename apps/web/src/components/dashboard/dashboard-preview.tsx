import { Maximize2, Minimize2 } from "lucide-react";

import { ScreenPreview } from "@/components/screen-preview";
import { StreamSettings } from "@/components/stream-settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { usePlayerControls } from "@/hooks/use-player-controls";
import { cn } from "@/lib/utils";

interface DashboardPreviewProps {
  stream: MediaStream | null;
  errorMessage: string | null;
  isLive: boolean;
}

export function DashboardPreview({
  stream,
  errorMessage,
  isLive,
}: DashboardPreviewProps) {
  const {
    containerRef,
    isFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(stream !== null);
  const {
    controlsRef,
    areControlsVisible,
    showControls,
    beginControlsInteraction,
    endControlsInteraction,
    handleControlsBlur,
  } = usePlayerControls(stream !== null, isFullscreen);

  return (
    <Card className="gap-0 overflow-visible bg-white/[0.03] p-3 ring-white/10 sm:p-4">
      <div
        ref={containerRef}
        className={cn(
          "group/preview relative aspect-video w-full overflow-hidden rounded-xl bg-black",
          isFullscreen &&
            "h-screen w-screen max-w-none rounded-none",
          !areControlsVisible && "cursor-none",
        )}
        onPointerEnter={showControls}
        onPointerMove={showControls}
        onDoubleClick={() => {
          if (stream) {
            void toggleFullscreen();
          }
        }}
      >
        <div className="absolute inset-0">
          <ScreenPreview
            stream={stream}
            className={cn(
              "h-full w-full max-w-none rounded-none object-contain",
              isFullscreen && "max-w-none",
            )}
          />
        </div>

        {stream && (
          <div
            ref={controlsRef}
            className={cn(
              "absolute bottom-3 right-3 z-10 flex items-center gap-1 transition-opacity duration-200 sm:bottom-4 sm:right-4",
              areControlsVisible
                ? "opacity-100"
                : "pointer-events-none opacity-0",
            )}
            onPointerEnter={beginControlsInteraction}
            onPointerLeave={endControlsInteraction}
            onFocusCapture={beginControlsInteraction}
            onBlurCapture={handleControlsBlur}
          >
            {isLive && <StreamSettings />}

            {isFullscreenSupported && (
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                onClick={() => void toggleFullscreen()}
                onDoubleClick={(event) => event.stopPropagation()}
                className="border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-sm hover:bg-black/80"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={`${isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} (F)`}
              >
                {isFullscreen ? (
                  <Minimize2 className="size-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="size-4" aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
        )}

        {!stream && errorMessage && (
          <p
            className="absolute bottom-4 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border border-red-400/15 bg-red-400/10 px-3 py-2 text-center text-xs text-red-300 backdrop-blur-sm"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </Card>
  );
}