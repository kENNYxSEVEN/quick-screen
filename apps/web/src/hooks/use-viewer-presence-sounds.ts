import { useEffect, useRef } from "react";

type ViewerPresenceSound = "join" | "leave";

interface ViewerCountSnapshot {
  roomId: string;
  viewers: number;
}

const MIN_GAIN = 0.0001;

function scheduleTone(
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  peakGain: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startsAt);

  gain.gain.setValueAtTime(MIN_GAIN, startsAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startsAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(MIN_GAIN, startsAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.01);
}

function playPresenceSound(context: AudioContext, sound: ViewerPresenceSound) {
  const startsAt = context.currentTime + 0.01;

  if (sound === "join") {
    scheduleTone(context, 659.25, startsAt, 0.11, 0.045);
    scheduleTone(context, 880, startsAt + 0.075, 0.15, 0.038);

    return;
  }

  scheduleTone(context, 659.25, startsAt, 0.11, 0.04);
  scheduleTone(context, 493.88, startsAt + 0.075, 0.16, 0.034);
}

/**
 * Plays a small host-side cue whenever the live viewer count changes.
 *
 * The initial count is only used as a baseline, so opening or refreshing a
 * room with viewers already present stays silent. If several viewers arrive or
 * leave in one update, the cue is intentionally played once rather than once
 * per viewer.
 */
export function useViewerPresenceSounds(roomId: string, viewerCount: number) {
  const previousSnapshotRef = useRef<ViewerCountSnapshot>({
    roomId,
    viewers: viewerCount,
  });
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlockAudio = () => {
      try {
        const context = audioContextRef.current ?? new AudioContext();

        audioContextRef.current = context;

        if (context.state === "suspended") {
          void context.resume().catch(() => undefined);
        }
      } catch {
        // Audio cues are optional UX.
      }
    };

    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);

      const context = audioContextRef.current;

      audioContextRef.current = null;

      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;

    if (previousSnapshot.roomId !== roomId) {
      previousSnapshotRef.current = { roomId, viewers: viewerCount };

      return;
    }

    previousSnapshotRef.current = { roomId, viewers: viewerCount };

    if (previousSnapshot.viewers === viewerCount) {
      return;
    }

    const sound: ViewerPresenceSound =
      viewerCount > previousSnapshot.viewers ? "join" : "leave";

    try {
      const context = audioContextRef.current ?? new AudioContext();

      audioContextRef.current = context;

      if (context.state === "suspended") {
        const requestedAt = performance.now();

        void context
          .resume()
          .then(() => {
            // Some browsers keep resume() pending until a later user gesture.
            // Do not play an old presence event after that gesture finally happens.
            if (context.state === "running" && performance.now() - requestedAt < 500) {
              playPresenceSound(context, sound);
            }
          })
          .catch(() => undefined);

        return;
      }

      if (context.state === "running") {
        playPresenceSound(context, sound);
      }
    } catch {
      // Audio cues are optional UX. Unsupported/blocked audio must never
      // interfere with room realtime updates.
    }
  }, [roomId, viewerCount]);
}
