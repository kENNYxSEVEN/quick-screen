import { Loader2, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useStreamSettings } from "@/hooks/use-stream-settings";
import { cn } from "@/lib/utils";
import type {
  StreamBitrate,
  StreamFrameRate,
  StreamQuality,
} from "@/types/stream-settings";

type SettingsOptionValue = StreamQuality | StreamFrameRate | StreamBitrate;

interface SettingsOption<T extends SettingsOptionValue> {
  label: string;
  value: T;
}

interface SettingsSectionProps<T extends SettingsOptionValue> {
  label: string;
  unit?: string;
  options: readonly SettingsOption<T>[];
  value: T;
  onChange(value: T): void;
  disabled: boolean;
}

interface StreamSettingsProps {
  className?: string;
  buttonClassName?: string;
  buttonSize?: "icon" | "icon-lg";
  placement?: "above" | "below" | "home";
}

const qualityOptions: readonly SettingsOption<StreamQuality>[] = [
  { label: "Auto", value: "auto" },
  { label: "720p", value: "720p" },
  { label: "1080p", value: "1080p" },
  { label: "1440p", value: "1440p" },
];

const frameRateOptions: readonly SettingsOption<StreamFrameRate>[] = [
  { label: "Auto", value: "auto" },
  { label: "30", value: 30 },
  { label: "60", value: 60 },
];

const bitrateOptions: readonly SettingsOption<StreamBitrate>[] = [
  { label: "Auto", value: "auto" },
  { label: "3", value: 3 },
  { label: "6", value: 6 },
  { label: "10", value: 10 },
  { label: "15", value: 15 },
];

function SettingsSection<T extends SettingsOptionValue>({
  label,
  unit,
  options,
  value,
  onChange,
  disabled,
}: SettingsSectionProps<T>) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-zinc-400">{label}</p>
        {unit && (
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">
            {unit}
          </span>
        )}
      </div>

      <div
        className="grid overflow-hidden rounded-lg border border-white/[0.08] bg-[#0a0a0a]"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option, index) => {
          const isSelected = value === option.value;

          return (
            <button
              key={String(option.value)}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative h-9 min-w-0 px-2 text-xs font-medium transition-colors outline-none",
                "text-zinc-400 hover:bg-white/[0.035] hover:text-zinc-200",
                "focus-visible:z-10 focus-visible:bg-white/[0.05] focus-visible:text-white",
                index > 0 && "border-l border-white/[0.07]",
                isSelected &&
                  "bg-white/[0.09] text-zinc-100 hover:bg-white/[0.11] hover:text-white",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StreamSettings({
  className,
  buttonClassName,
  buttonSize = "icon-lg",
  placement = "above",
}: StreamSettingsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [homePanelStyle, setHomePanelStyle] = useState<CSSProperties | undefined>();
  const {
    settings,
    errorMessage,
    isApplying,
    updateSettings,
  } = useStreamSettings();

  useLayoutEffect(() => {
    if (!isOpen || placement !== "home") {
      setHomePanelStyle(undefined);
      return;
    }

    function positionPanel() {
      const trigger = rootRef.current;
      const panel = panelRef.current;

      if (!trigger || !panel) {
        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gap = 12;
      const edge = 16;

      if (viewportWidth < 640) {
        setHomePanelStyle({
          position: "fixed",
          left: edge,
          right: edge,
          bottom: edge,
          top: "auto",
          width: "auto",
          maxHeight: `calc(100svh - ${edge * 2}px)`,
        });
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(340, viewportWidth - edge * 2);
      const panelHeight = panelRect.height;

      const rightSpace = viewportWidth - triggerRect.right - edge;
      const leftSpace = triggerRect.left - edge;
      const belowSpace = viewportHeight - triggerRect.bottom - edge;
      const aboveSpace = triggerRect.top - edge;

      let left: number;
      let top: number;

      if (rightSpace >= panelWidth + gap) {
        left = triggerRect.right + gap;
        top = triggerRect.top + triggerRect.height / 2 - panelHeight / 2;
      } else if (leftSpace >= panelWidth + gap) {
        left = triggerRect.left - panelWidth - gap;
        top = triggerRect.top + triggerRect.height / 2 - panelHeight / 2;
      } else if (belowSpace >= panelHeight + gap || belowSpace >= aboveSpace) {
        left = triggerRect.right - panelWidth;
        top = triggerRect.bottom + gap;
      } else {
        left = triggerRect.right - panelWidth;
        top = triggerRect.top - panelHeight - gap;
      }

      left = Math.max(edge, Math.min(left, viewportWidth - panelWidth - edge));
      top = Math.max(edge, Math.min(top, viewportHeight - panelHeight - edge));

      setHomePanelStyle({
        position: "fixed",
        left,
        top,
        right: "auto",
        bottom: "auto",
        width: panelWidth,
        maxHeight: viewportHeight - edge * 2,
      });
    }

    const frame = window.requestAnimationFrame(positionPanel);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [isOpen, placement]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === "Escape") {
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

  function updateQuality(quality: StreamQuality) {
    void updateSettings({ ...settings, quality });
  }

  function updateFrameRate(frameRate: StreamFrameRate) {
    void updateSettings({ ...settings, frameRate });
  }

  function updateBitrate(bitrate: StreamBitrate) {
    void updateSettings({ ...settings, bitrate });
  }

  const settingsPanel = isOpen ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Stream settings"
      style={
        placement === "home"
          ? homePanelStyle ?? {
              position: "fixed",
              left: -9999,
              top: -9999,
              visibility: "hidden",
            }
          : undefined
      }
      className={cn(
        "overflow-hidden rounded-xl border border-white/[0.09] bg-[#141414]/98 shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-md",
        placement === "home"
          ? "fixed z-[100] w-[min(340px,calc(100vw-2rem))] max-h-[calc(100svh-2rem)] overflow-y-auto"
          : [
              "absolute right-0 z-30 w-[min(340px,calc(100vw-2rem))]",
              placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
            ],
      )}
    >
      <div className="border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.025] text-zinc-400">
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          </span>

          <div>
            <p className="text-sm font-medium text-zinc-200">
              Stream settings
            </p>
          </div>

          <span
            className="ml-auto flex size-7 items-center justify-center"
            aria-label={isApplying ? "Applying settings" : undefined}
          >
            <Loader2
              className={cn(
                "size-3.5 text-zinc-400 transition-opacity",
                isApplying ? "animate-spin opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <SettingsSection
          label="Quality"
          options={qualityOptions}
          value={settings.quality}
          onChange={updateQuality}
          disabled={isApplying}
        />

        <SettingsSection
          label="Frame rate"
          unit="FPS"
          options={frameRateOptions}
          value={settings.frameRate}
          onChange={updateFrameRate}
          disabled={isApplying}
        />

        <SettingsSection
          label="Bitrate"
          unit="Mbps"
          options={bitrateOptions}
          value={settings.bitrate}
          onChange={updateBitrate}
          disabled={isApplying}
        />
      </div>

      {errorMessage && (
        <p
          className="border-t border-red-400/15 bg-red-400/[0.035] px-4 py-3 text-xs leading-5 text-red-300"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <Button
        type="button"
        variant="outline"
        size={buttonSize}
        onClick={() => setIsOpen((open) => !open)}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(
          "border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-sm hover:bg-black/80",
          buttonClassName,
        )}
        aria-label="Stream settings"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Stream settings"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
      </Button>

      {placement === "home"
        ? typeof document !== "undefined" &&
          settingsPanel &&
          createPortal(settingsPanel, document.body)
        : settingsPanel}
    </div>
  );
}