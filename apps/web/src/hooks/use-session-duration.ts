import { useEffect, useState } from "react";

function formatElapsedTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function useSessionDuration(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);

    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  const elapsedMilliseconds = startedAt ? Math.max(0, now - startedAt) : 0;

  return formatElapsedTime(elapsedMilliseconds);
}
