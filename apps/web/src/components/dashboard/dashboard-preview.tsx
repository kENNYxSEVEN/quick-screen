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
  isLive: boolean;
  isSelectingScreen: boolean;
  onSelectScreen: () => void;
}

export function DashboardPreview({
  stream,
  isLive,
  isSelectingScreen,
  onSelectScreen,
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
    <Card className="gap-0 overflow-visible rounded-xl bg-[#121212] p-2.5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] ring-white/[0.08] sm:p-3">
      <div
        ref={containerRef}
        className={cn(
          "group/preview relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-white/[0.05]",
          isFullscreen && "h-screen w-screen max-w-none rounded-none ring-0",
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
            isSelectingScreen={isSelectingScreen}
            onSelectScreen={onSelectScreen}
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
              "absolute bottom-3 right-3 z-10 flex items-center gap-1.5 transition-opacity duration-200 sm:bottom-4 sm:right-4",
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
                className="border-white/[0.12] bg-black/60 text-zinc-200 shadow-lg backdrop-blur-md hover:bg-black/80 hover:text-white"
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

      </div>
    </Card>
  );
}
