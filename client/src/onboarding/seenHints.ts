/**
 * Which contextual first-time hints (see `useOnboardingHint.ts`) have already
 * been shown, ever, in this browser — so each one fires at most once. Same
 * localStorage-with-try/catch shape as `graphics/settings.ts`/`audio/settings.ts`:
 * losing this preference is a minor annoyance (a hint repeats once), never
 * something worth breaking the game over.
 */

const STORAGE_KEY = "foghaven.onboarding.seenHints";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function save(seen: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage can be unavailable (private mode, quota, disabled) — a hint
    // simply showing again next time is an acceptable degradation.
  }
}

export function hasSeenHint(id: string): boolean {
  return load().has(id);
}

export function markHintSeen(id: string): void {
  const seen = load();
  if (seen.has(id)) {
    return;
  }
  seen.add(id);
  save(seen);
}
