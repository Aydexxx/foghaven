import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import type { GameState } from "../net/types";
import { joinGame } from "../net/client";

interface LobbyProps {
  onJoined: (room: Room<GameState>) => void;
}

type Status = "idle" | "joining" | "error";

export function Lobby({ onJoined }: LobbyProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("joining");
    try {
      const room = await joinGame(name, roomCode);
      onJoined(room);
    } catch {
      setStatus("error");
    }
  };

  const joining = status === "joining";

  return (
    <form className="lobby" onSubmit={submit}>
      <h1>{t("app.title")}</h1>
      <h2>{t("lobby.heading")}</h2>

      <label className="field">
        <span>{t("lobby.nameLabel")}</span>
        <input
          type="text"
          value={name}
          placeholder={t("lobby.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          disabled={joining}
        />
      </label>

      <label className="field">
        <span>{t("lobby.roomCodeLabel")}</span>
        <input
          type="text"
          value={roomCode}
          placeholder={t("lobby.roomCodePlaceholder")}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          disabled={joining}
        />
      </label>

      <button type="submit" disabled={joining}>
        {joining ? t("lobby.joiningButton") : t("lobby.joinButton")}
      </button>

      {status === "error" && <p className="error">{t("lobby.error")}</p>}
    </form>
  );
}
