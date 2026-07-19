import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import type { GameState } from "../net/types";
import { createRoom, joinRoomByCode } from "../net/client";

interface MainMenuProps {
  name: string;
  onJoined: (room: Room<GameState>) => void;
}

type Mode = "menu" | "join";
type ErrorKey = "mainMenu.createError" | "mainMenu.joinError";

export function MainMenu({ name, onJoined }: MainMenuProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("menu");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(name);
      onJoined(room);
    } catch {
      setError("mainMenu.createError");
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
      const room = await joinRoomByCode(name, trimmed);
      onJoined(room);
    } catch {
      setError("mainMenu.joinError");
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
      <p className="hint">{t("mainMenu.greeting", { name })}</p>

      <button type="button" onClick={handleCreate} disabled={busy}>
        {busy ? t("mainMenu.creatingButton") : t("mainMenu.createButton")}
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => setMode("join")}
        disabled={busy}
      >
        {t("mainMenu.joinByCodeButton")}
      </button>

      {error && <p className="error">{t(error)}</p>}
    </div>
  );
}
