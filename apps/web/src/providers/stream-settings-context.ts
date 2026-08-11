import { createContext } from "react";

import type { StreamSettingsContextValue } from "@/types/stream-settings";

export const StreamSettingsContext =
  createContext<StreamSettingsContextValue | null>(null);
