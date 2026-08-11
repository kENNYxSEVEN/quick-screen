import { useCallback, useEffect, useRef, useState } from "react";

const CONTROLS_HIDE_DELAY_MS = 3_000;

export function usePlayerControls(enabled: boolean, resetKey?: unknown) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const isInteractingWithControlsRef = useRef(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsHideTimer();

    if (!enabled || isInteractingWithControlsRef.current) {
      return;
    }

    controlsHideTimerRef.current = window.setTimeout(() => {
      if (!isInteractingWithControlsRef.current) {
        setAreControlsVisible(false);
      }
    }, CONTROLS_HIDE_DELAY_MS);
  }, [clearControlsHideTimer, enabled]);

  const showControls = useCallback(() => {
    if (!enabled) {
      return;
    }

    setAreControlsVisible(true);
    scheduleControlsHide();
  }, [enabled, scheduleControlsHide]);

  const beginControlsInteraction = useCallback(() => {
    isInteractingWithControlsRef.current = true;
    clearControlsHideTimer();
    setAreControlsVisible(true);
  }, [clearControlsHideTimer]);

  const endControlsInteraction = useCallback(() => {
    isInteractingWithControlsRef.current = false;
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const handleControlsBlur = useCallback(() => {
    window.setTimeout(() => {
      if (!controlsRef.current?.contains(document.activeElement)) {
        endControlsInteraction();
      }
    }, 0);
  }, [endControlsInteraction]);

  useEffect(() => {
    clearControlsHideTimer();

    if (!enabled) {
      setAreControlsVisible(true);

      return;
    }

    showControls();

    return clearControlsHideTimer;
  }, [clearControlsHideTimer, enabled, resetKey, showControls]);

  return {
    controlsRef,
    areControlsVisible,
    showControls,
    beginControlsInteraction,
    endControlsInteraction,
    handleControlsBlur,
  };
}
