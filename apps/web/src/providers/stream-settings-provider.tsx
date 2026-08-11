import { useCallback, useMemo, useState, type PropsWithChildren } from "react";

import {
  applyVideoTrackSettings,
  areStreamSettingsEqual,
  getMaxBitrate,
  getStoredStreamSettings,
  storeStreamSettings,
} from "@/lib/stream-settings";
import { useMedia } from "@/hooks/use-media";
import { useScreen } from "@/hooks/use-screen";
import { StreamSettingsContext } from "@/providers/stream-settings-context";
import type {
  StreamSettings,
  StreamSettingsContextValue,
} from "@/types/stream-settings";

function getSettingsErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "OverconstrainedError") {
    return "This source does not support that setting.";
  }

  return "Could not apply that setting. Keeping the previous value.";
}

export function StreamSettingsProvider({ children }: PropsWithChildren) {
  const { stream } = useScreen();
  const { setPublisherBitrate } = useMedia();
  const [settings, setSettings] = useState(getStoredStreamSettings);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const updateSettings = useCallback(async (nextSettings: StreamSettings) => {
    if (areStreamSettingsEqual(settings, nextSettings)) {
      return true;
    }

    const qualityOrFrameRateChanged =
      settings.quality !== nextSettings.quality ||
      settings.frameRate !== nextSettings.frameRate;
    const bitrateChanged = settings.bitrate !== nextSettings.bitrate;

    setErrorMessage(null);
    setIsApplying(true);

    try {
      if (stream && qualityOrFrameRateChanged) {
        await applyVideoTrackSettings(stream, nextSettings);
      }

      if (stream && bitrateChanged) {
        await setPublisherBitrate(getMaxBitrate(nextSettings));
      }

      setSettings(nextSettings);
      storeStreamSettings(nextSettings);

      return true;
    } catch (error) {
      setErrorMessage(getSettingsErrorMessage(error));

      return false;
    } finally {
      setIsApplying(false);
    }
  }, [setPublisherBitrate, settings, stream]);

  const value = useMemo<StreamSettingsContextValue>(
    () => ({
      settings,
      errorMessage,
      isApplying,
      updateSettings,
    }),
    [errorMessage, isApplying, settings, updateSettings],
  );

  return (
    <StreamSettingsContext.Provider value={value}>
      {children}
    </StreamSettingsContext.Provider>
  );
}
