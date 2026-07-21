/**
 * Persistence for the one piece of information a returning player cannot
 * reconstruct: their reconnection token.
 *
 * The token lives in `localStorage` rather than `sessionStorage` on purpose —
 * `sessionStorage` dies with the tab, which is precisely the case this exists
 * to survive. A player who closes the tab and reopens it is holding the same
 * seat as long as the server's grace period is still open, and the token is
 * what proves it.
 *
 * Nothing secret is stored here. The token only identifies a seat the server
 * is already holding for this browser; the role attached to that seat is never
 * written down client-side, it is re-sent privately once the server has
 * accepted the reconnection.
 */

const STORAGE_KEY = "foghaven.session";

/** Just the two fields of a joined room that identify the held seat. */
interface Seat {
  roomId: string;
  reconnectionToken: string;
}

export interface StoredSession {
  /** `roomId:token`, exactly as `Room.reconnectionToken` formats it. */
  token: string;
  roomId: string;
  /** Carried so a resumed session skips the name prompt. */
  name: string;
  /** When this was written, so an obviously stale token is not even tried. */
  savedAt: number;
}

/**
 * Remember the current seat. Must be called after *every* successful join,
 * including reconnections: the server issues a fresh token each time a socket
 * attaches, so the previous one stops working the moment it is used.
 */
export function saveSession(room: Seat, name: string): void {
  try {
    const session: StoredSession = {
      token: room.reconnectionToken,
      roomId: room.roomId,
      name,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode, quota, disabled). Reconnection
    // is a convenience — losing it must never break joining a room.
  }
}

/** The stored seat, if one was saved and is not older than `maxAgeMs`. */
export function loadSession(maxAgeMs: number): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== "string" || !parsed.token.includes(":")) {
      return null;
    }
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > maxAgeMs) {
      // The server stopped holding this seat long ago; trying it would only
      // produce an error the player would have to sit through.
      return null;
    }

    return {
      token: parsed.token,
      roomId: typeof parsed.roomId === "string" ? parsed.roomId : "",
      name: typeof parsed.name === "string" ? parsed.name : "",
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/** Forget the seat. Called on a deliberate leave and on a failed resume. */
export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveSession.
  }
}
