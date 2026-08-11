import { useContext } from "react";

import { StreamSettingsContext } from "@/providers/stream-settings-context";

export function useStreamSettings() {
  const context = useContext(StreamSettingsContext);

  if (!context) {
    throw new Error("useStreamSettings must be used within StreamSettingsProvider.");
  }

  return context;
}
