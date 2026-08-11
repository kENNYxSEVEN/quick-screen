import { createContext } from "react";

import type { ScreenContextValue } from "@/types/screen";

export const ScreenContext = createContext<ScreenContextValue | null>(null);
