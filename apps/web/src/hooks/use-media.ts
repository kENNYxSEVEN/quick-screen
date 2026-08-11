import { useContext } from "react";

import { MediaContext } from "@/providers/media-context";

export function useMedia() {
  const context = useContext(MediaContext);

  if (!context) {
    throw new Error("useMedia must be used within MediaProvider.");
  }

  return context;
}
