import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import type { GameState } from "../net/types";
import { classifyJoinError, createRoom, joinRoomByCode } from "../net/client";

interface MainMenuProps {
  name: string;
  /** The signed-in user's auth token; null for a guest. */
  token: string | null;
  /** Guests may join by code but not create rooms — see `GameRoom.onAuth`. */
  isGuest: boolean;
  onJoined: (room: Room<GameState>) => void;
  onSignOut: () => void;
  /** Opens the friends panel — hidden for guests, who have no account to befriend anyone with. */
  onOpenFriends?: () => void;
  /** Opens the cosmetics inventory/shop — hidden for guests, who have no account to own anything with. */
  onOpenInventory?: () => void;
  /** Opens the profile screen (stats, badges, account deletion) — hidden for guests, who have no account to have stats attached to. */
  onOpenProfile?: () => void;
  /** A transient message from outside the normal join flow (e.g. a stale invite link). */
  notice?: string | null;
}

type Mode = "menu" | "join";
type ErrorKey =
  | "mainMenu.createError"
  | "mainMenu.joinError"
  | "mainMenu.roomFullError"
  | "mainMenu.inProgressError"
  | "mainMenu.bannedError"
  | "mainMenu.authError"
  | "mainMenu.guestNoCreateError"
  | "mainMenu.blockedError";

/**
 * The server refuses joins with codes of its own — full, started, banned,
 * unauthenticated, guest-tried-to-create — so each gets a real explanation
 * instead of being lumped in with "that code doesn't exist", which is all the
 * matchmaker alone could tell us.
 */
const JOIN_ERROR_KEY: Record<string, ErrorKey> = {
  full: "mainMenu.roomFullError",
  inProgress: "mainMenu.inProgressError",
  banned: "mainMenu.bannedError",
  authInvalid: "mainMenu.authError",
  guestNoCreate: "mainMenu.guestNoCreateError",
  blocked: "mainMenu.blockedError",
  unknown: "mainMenu.joinError",
};

export function MainMenu({
  name,
  token,
  isGuest,
  onJoined,
  onSignOut,
  onOpenFriends,
  onOpenInventory,
  onOpenProfile,
  notice,
}: MainMenuProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("menu");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(name, token);
      onJoined(room);
    } catch (err) {
      setError(JOIN_ERROR_KEY[classifyJoinError(err)] ?? "mainMenu.createError");
      setBusy(false);
    }
  };

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room = await joinRoomByCode(name, trimmed, token);
      onJoined(room);
    } catch (err) {
      setError(JOIN_ERROR_KEY[classifyJoinError(err)] ?? "mainMenu.joinError");
      setBusy(false);
    }
  };

  if (mode === "join") {
    return (
      <form className="panel" onSubmit={handleJoin}>
        <h1>{t("mainMenu.joinHeading")}</h1>

        <label className="field">
          <span>{t("mainMenu.roomCodeLabel")}</span>
          <input
            type="text"
            value={code}
            placeholder={t("mainMenu.roomCodePlaceholder")}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={busy}
            autoFocus
          />
        </label>

        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? t("mainMenu.joiningButton") : t("mainMenu.joinButton")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setMode("menu");
            setError(null);
          }}
          disabled={busy}
        >
          {t("mainMenu.backButton")}
        </button>

        {error && <p className="error">{t(error)}</p>}
      </form>
    );
  }

  return (
    <div className="panel">
      <h1>{t("app.title")}</h1>
      <p className="hint">
        {t("mainMenu.greeting", { name })}
        {isGuest && <span className="guest-tag"> · {t("mainMenu.guestTag")}</span>}
      </p>

      {notice && <p className="error">{notice}</p>}

      {/* Guests may only join a friend's room, never create one — the server
          enforces this at onAuth, so hiding it here is just matching UX. */}
      {!isGuest && (
        <button type="button" onClick={handleCreate} disabled={busy}>
          {busy ? t("mainMenu.creatingButton") : t("mainMenu.createButton")}
        </button>
      )}
      <button
        type="button"
        className="secondary"
        onClick={() => setMode("join")}
        disabled={busy}
      >
        {t("mainMenu.joinByCodeButton")}
      </button>

      {isGuest && <p className="hint">{t("mainMenu.guestNoCreateHint")}</p>}

      {!isGuest && onOpenFriends && (
        <button type="button" className="secondary" onClick={onOpenFriends} disabled={busy}>
          {t("mainMenu.friendsButton")}
        </button>
      )}
      {!isGuest && onOpenInventory && (
        <button type="button" className="secondary" onClick={onOpenInventory} disabled={busy}>
          {t("mainMenu.inventoryButton")}
        </button>
      )}
      {!isGuest && onOpenProfile && (
        <button type="button" className="secondary" onClick={onOpenProfile} disabled={busy}>
          {t("mainMenu.profileButton")}
        </button>
      )}

      <button type="button" className="link-button" onClick={onSignOut} disabled={busy}>
        {isGuest ? t("mainMenu.signInButton") : t("mainMenu.signOutButton")}
      </button>

      {error && <p className="error">{t(error)}</p>}
    </div>
  );
}
