import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import { MIN_PLAYERS } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { readRoomSettings } from "../net/settings";
import { LobbyCanvas } from "../game/LobbyCanvas";
import { LobbySettingsPanel } from "./LobbySettingsPanel";
import { Button, Panel } from "./primitives";

/** One line of the assistive-technology roster mirror — see its use below. */
interface RosterEntry {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
}

interface LobbyRoomProps {
  room: Room<GameState>;
  onLeave: () => void;
  /** Opens the friends panel with this room pre-selected to invite into — absent for guests. */
  onOpenFriends?: () => void;
}

/**
 * The waiting room — a walkable Tavern rather than a form (ART_BIBLE §5.2).
 *
 * The room itself is the primary interface: players spawn as their Havener,
 * walk around, see each other, and declare themselves ready by standing on
 * the marked flagstone by the door. This component owns only what can't live
 * in the world — the persistent room-code/invite HUD, the start and leave
 * controls, and the settings overlay the Tavern's table opens.
 *
 * The roster moved into the world wholesale: names are nameplates, the host
 * wears a voteGold crown, ready players carry a green check, and a player
 * inside their reconnection grace period is drawn faded with an "away" tag
 * rather than listed. See `LobbyScene`.
 *
 * Everything here remains a *request*. The server decides whether a start
 * actually happens, and re-derives the ready count from live positions when
 * it does — this component's `canStart` only keeps the button from promising
 * something that would then quietly not happen.
 */
export function LobbyRoom({ room, onLeave, onOpenFriends }: LobbyRoomProps) {
  const { t } = useTranslation();
  const [hostId, setHostId] = useState(room.state.hostId);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [localReady, setLocalReady] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [enabledRoleIds, setEnabledRoleIds] = useState<string[]>([]);
  const [preset, setPreset] = useState(room.state.rolePreset);
  const [settings, setSettings] = useState<Record<string, number | boolean>>(() =>
    readRoomSettings(room),
  );

  useEffect(() => {
    const sync = () => {
      let ready = 0;
      let present = 0;
      const entries: RosterEntry[] = [];
      room.state.players.forEach((player, id) => {
        entries.push({
          id,
          name: player.name,
          connected: player.connected,
          ready: player.ready,
        });
        if (player.connected) {
          present++;
          if (player.ready) {
            ready++;
          }
        }
      });
      setRoster(entries);
      setReadyCount(ready);
      setPresentCount(present);
      setLocalReady(room.state.players.get(room.sessionId)?.ready ?? false);

      const ids: string[] = [];
      room.state.enabledRoleIds.forEach((id) => ids.push(id));
      setEnabledRoleIds(ids);
      setPreset(room.state.rolePreset);
      setSettings(readRoomSettings(room));
    };

    const unlistenHost = room.state.listen("hostId", setHostId);
    room.onStateChange(sync);
    sync();

    return () => {
      unlistenHost();
      room.onStateChange.remove(sync);
    };
  }, [room]);

  const isHost = hostId === room.sessionId;
  // Mirrors the server's own rule exactly (`handleStart`): the gate is how
  // many players are standing on the flagstone, not how many are in the room.
  const canStart = readyCount >= MIN_PLAYERS;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission can be denied; the code is already visible on
      // screen, so failing to copy silently is an acceptable fallback.
    }
  };

  /**
   * The growth loop: a link that drops whoever opens it straight into this
   * room, no code to type — meant to be pasted into Discord. `App.tsx` reads
   * the `invite` query param back out on load and joins with it directly
   * (see its own doc comment); a query param rather than a path segment so
   * it works unchanged against a static host with no server-side rewrite
   * rule for a `/join/:code`-style path.
   */
  const copyInviteLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.search = `?invite=${room.roomId}`;
      await navigator.clipboard.writeText(url.toString());
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // See copyCode — the code itself is still visible on screen either way.
    }
  };

  return (
    <div className="lobby-room" role="region" aria-label={t("lobbyRoom.heading")}>
      <LobbyCanvas room={room} onOpenSettings={() => setShowSettings(true)} />

      {/*
        The roster now lives in the world — nameplates, a crown, green checks.
        A canvas is opaque to assistive technology, so the same information is
        mirrored here as real text. This is not decoration: before this screen
        became a room, the roster WAS a list, and dropping it entirely would
        be a genuine regression for anyone using a screen reader.
      */}
      <ul className="visually-hidden" aria-live="polite">
        {roster.map((player) => (
          <li key={player.id}>
            {player.name}
            {player.id === hostId ? ` — ${t("lobbyRoom.hostTag")}` : ""}
            {player.ready ? ` — ${t("lobbyRoom.readyTag")}` : ""}
            {!player.connected ? ` — ${t("lobbyRoom.disconnectedTag")}` : ""}
          </li>
        ))}
      </ul>

      {/* Pinned, persistent, and deliberately small — the room is the screen. */}
      <Panel className="lobby-hud">
        <div className="lobby-hud-code">
          <span className="room-code-value">{room.roomId}</span>
          <Button onClick={copyCode}>
            {copied ? t("lobbyRoom.copied") : t("lobbyRoom.copyButton")}
          </Button>
        </div>

        <div className="lobby-hud-invites">
          <Button onClick={copyInviteLink}>
            {linkCopied ? t("lobbyRoom.copied") : t("lobbyRoom.copyInviteLinkButton")}
          </Button>
          {onOpenFriends && (
            <Button onClick={onOpenFriends}>{t("lobbyRoom.inviteFriendsButton")}</Button>
          )}
        </div>

        <p className="lobby-hud-ready" data-ready={localReady}>
          {t("lobbyRoom.readyCount", { count: readyCount, min: MIN_PLAYERS })}
        </p>
        <p className="hint lobby-hud-hint">
          {localReady ? t("lobbyRoom.youAreReady") : t("lobbyRoom.readyHint")}
        </p>
        <p className="hint lobby-hud-hint">
          {t("lobbyRoom.playerCount", { count: presentCount, min: MIN_PLAYERS })}
        </p>

        {isHost && (
          <Button variant="primary" onClick={() => room.send("start")} disabled={!canStart}>
            {t("lobbyRoom.startButton")}
          </Button>
        )}

        {/* The table in the room is the intended way in — this is the
            equivalent-access fallback, so the settings can never become
            unreachable for someone who can't easily walk to the table. */}
        <Button onClick={() => setShowSettings(true)}>{t("lobbyRoom.openSettingsButton")}</Button>

        <Button variant="destructive" onClick={onLeave}>
          {t("lobbyRoom.leaveButton")}
        </Button>
      </Panel>

      {showSettings && (
        <LobbySettingsPanel
          room={room}
          isHost={isHost}
          preset={preset}
          enabledRoleIds={enabledRoleIds}
          settings={settings}
          playerCount={presentCount}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
