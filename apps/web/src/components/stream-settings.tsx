import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  options: readonly SettingsOption<T>[];
  value: T;
  onChange(value: T): void;
  disabled: boolean;
}

interface StreamSettingsProps {
  className?: string;
  buttonClassName?: string;
  buttonSize?: "icon" | "icon-lg";
  placement?: "above" | "below";
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
  { label: "3 Mbps", value: 3 },
  { label: "6 Mbps", value: 6 },
  { label: "10 Mbps", value: 10 },
  { label: "15 Mbps", value: 15 },
];

function SettingsSection<T extends SettingsOptionValue>({
  label,
  options,
  value,
  onChange,
  disabled,
}: SettingsSectionProps<T>) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-400">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={String(option.value)}
            type="button"
            variant={value === option.value ? "secondary" : "ghost"}
            size="xs"
            disabled={disabled}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "border border-white/10 text-zinc-400 hover:bg-white/[0.07] hover:text-white",
              value === option.value && "border-white/15 bg-white/[0.1] text-white",
            )}
          >
            {option.label}
          </Button>
        ))}
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
  const [isOpen, setIsOpen] = useState(false);
  const {
    settings,
    errorMessage,
    isApplying,
    updateSettings,
  } = useStreamSettings();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
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

  return (
    <div ref={rootRef} className={cn("relative", className)}>
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

      {isOpen && (
        <div
          role="dialog"
          aria-label="Stream settings"
          className={cn(
            "absolute right-0 z-30 w-60 rounded-xl border border-white/10 bg-zinc-950/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-md",
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <div className="space-y-3">
            <SettingsSection
              label="Quality"
              options={qualityOptions}
              value={settings.quality}
              onChange={updateQuality}
              disabled={isApplying}
            />
            <SettingsSection
              label="Frame rate"
              options={frameRateOptions}
              value={settings.frameRate}
              onChange={updateFrameRate}
              disabled={isApplying}
            />
            <SettingsSection
              label="Bitrate"
              options={bitrateOptions}
              value={settings.bitrate}
              onChange={updateBitrate}
              disabled={isApplying}
            />
          </div>

          {errorMessage && (
            <p className="mt-3 border-t border-red-400/15 pt-2 text-xs leading-5 text-red-300" role="alert">
              {errorMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
