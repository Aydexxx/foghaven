import { useEffect, useState } from "react";

/**
 * Counts `durationMs` down locally from the moment `startedAt` changes.
 *
 * This is presentation only. The server owns every stage transition and will
 * move the room on regardless of what this shows — the countdown exists so a
 * player can see how long is left, not to decide anything. Counting locally
 * rather than off a server deadline avoids depending on client and server
 * clocks agreeing, which they don't.
 */
export function useCountdown(durationMs: number, startedAt: number): number {
  const [remainingMs, setRemainingMs] = useState(durationMs);

  useEffect(() => {
    const update = () => {
      setRemainingMs(Math.max(0, durationMs - (Date.now() - startedAt)));
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [durationMs, startedAt]);

  return remainingMs;
}
