import { useCallback, useEffect, useRef, useState } from "react";

import { isEditableKeyboardTarget } from "@/lib/keyboard";

export function useFullscreen(enabled = true) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;

    if (!enabled || !container || !document.fullscreenEnabled) {
      return;
    }

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
        return;
      }

      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      await container.requestFullscreen();
    } catch {
      // Browsers can reject fullscreen requests when they are not initiated
      // by an allowed user gesture. The UI stays synced via fullscreenchange.
    }
  }, [enabled]);

  useEffect(() => {
    function handleFullscreenChange() {
      const container = containerRef.current;

      setIsFullscreen(
        container !== null && document.fullscreenElement === container,
      );
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (enabled || document.fullscreenElement !== containerRef.current) {
      return;
    }

    void document.exitFullscreen().catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      // KeyboardEvent.code tracks the physical key and therefore works
      // regardless of the active Windows keyboard layout.
      if (event.code !== "KeyF") {
        return;
      }

      event.preventDefault();
      void toggleFullscreen();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, toggleFullscreen]);

  return {
    containerRef,
    isFullscreen,
    isFullscreenSupported: document.fullscreenEnabled,
    toggleFullscreen,
  };
}
