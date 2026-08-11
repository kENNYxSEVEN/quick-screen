import { createContext } from "react";

import type { MediaContextValue } from "@/types/media";

export const MediaContext = createContext<MediaContextValue | null>(null);
