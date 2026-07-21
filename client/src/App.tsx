import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  PHASE,
  RECONNECT_GRACE_MS,
  RECONNECT_RETRY_MS,
  type CameraRevealMessage,
  type ChatMessage,
  type ClientTask,
  type RoleAssignment,
  type TaskProgressMessage,
  type TasksMessage,
} from "@foghaven/shared";
import type { GameState } from "./net/types";
import { privateStateFor, resumeRoom } from "./net/client";
import { clearSession, loadSession } from "./net/session";
import { clearAuth, fetchMe, loadAuth, saveAuth, type AuthSession } from "./net/auth";
import { readRoomSettings } from "./net/settings";
import { audioEngine } from "./audio/audioEngine";
import { useGameAudio } from "./audio/useGameAudio";
import { AuthScreen } from "./ui/AuthScreen";
import { MainMenu } from "./ui/MainMenu";
import { LobbyRoom } from "./ui/LobbyRoom";
import { RoleReveal } from "./ui/RoleReveal";
import { GameView } from "./ui/GameView";
import { MeetingScreen } from "./ui/MeetingScreen";
import { GameOverScreen } from "./ui/GameOverScreen";
import { ReconnectOverlay } from "./ui/ReconnectOverlay";
import { AudioSettingsPanel } from "./ui/AudioSettingsPanel";
import { GraphicsSettingsPanel } from "./ui/GraphicsSettingsPanel";

type Screen =
  | "resuming"
  | "auth"
  | "menu"
  | "lobby"
  | "reveal"
  | "game"
  | "meeting"
  | "gameOver";

const SCREEN_FOR_PHASE: Record<string, Screen> = {
  [PHASE.LOBBY]: "lobby",
  [PHASE.ROLE_REVEAL]: "reveal",
  [PHASE.PLAYING]: "game",
  [PHASE.MEETING]: "meeting",
  [PHASE.GAME_OVER]: "gameOver",
};

/** Colyseus's "consented leave" close code — the player meant to go. */
const CONSENTED_LEAVE = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const { t } = useTranslation();
  // A stored seat is checked before the first paint, so a returning player
  // never sees the auth screen flash past on their way back into the round; a
  // stored (still-valid) auth token skips straight to the menu.
  const [screen, setScreen] = useState<Screen>(() =>
    loadSession(RECONNECT_GRACE_MS) ? "resuming" : loadAuth() ? "menu" : "auth",
  );
  /** The signed-in account, or null for a guest / signed-out. */
  const [auth, setAuth] = useState<AuthSession | null>(() => loadAuth());
  /** True once someone chose "play as guest" — gates room creation and shows differently. */
  const [isGuest, setIsGuest] = useState(false);
  const [name, setName] = useState(() => loadAuth()?.user.username ?? "");
  const [room, setRoom] = useState<Room<GameState> | null>(null);
  const [assignment, setAssignment] = useState<RoleAssignment | null>(null);
  const [tasks, setTasks] = useState<ClientTask[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [enabledRoleIds, setEnabledRoleIds] = useState<string[]>([]);
  /** The host's `strangerCount` balance setting — 0 means "Auto". Feeds the reveal screen's tally. */
  const [strangerCountOverride, setStrangerCountOverride] = useState(0);
  /** True while a dropped connection is being retried. */
  const [reconnecting, setReconnecting] = useState(false);
  /**
   * Set just before a deliberate `leave()`, so the resulting `onLeave` is
   * recognised as intentional rather than treated as a drop worth chasing.
   */
  const leavingRef = useRef(false);
  /**
   * The reconnection currently in flight, if any. A reconnection token is
   * single-use, so two overlapping attempts would mean the second one spending
   * a token the first had already redeemed and then reporting failure for a
   * session that is actually back. Sharing one promise makes every caller
   * — including React's double-invoked effects in development — wait on the
   * same attempt and see the same answer.
   */
  const resumeInFlight = useRef<Promise<boolean> | null>(null);
  /**
   * Chat lives here rather than in the meeting screen because a ghost's
   * channel stays open during play too — the log has to survive the meeting
   * screen mounting and unmounting.
   */
  const [chat, setChat] = useState<ChatMessage[]>([]);
  /**
   * A watchman's camera footage, delivered once at the start of a meeting —
   * captured here rather than inside `MeetingScreen` for the same reason
   * `role`/`tasks` are: the server can send it in the same tick the phase
   * flips, before the screen that displays it has mounted to listen.
   */
  const [cameraReveal, setCameraReveal] = useState<CameraRevealMessage | null>(null);
  /**
   * Whether the Silencer gagged the local player for the meeting currently
   * in progress — captured here for the same reconnection-timing reason as
   * `cameraReveal`: the server sends this the instant `startMeeting` runs,
   * which can be before `MeetingScreen` has mounted to listen for it.
   */
  const [silenced, setSilenced] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [showGraphicsSettings, setShowGraphicsSettings] = useState(false);

  // Room-level stingers and the tension score behind the adaptive music —
  // see the hook's own doc for why this is the one place both live,
  // independent of whichever screen the phase currently has on display.
  useGameAudio(room, assignment?.role ?? null);

  const handleAuthenticated = useCallback((session: AuthSession) => {
    // The earliest real click in the app — browsers refuse to start audio
    // without one, so this is where the `AudioContext` gets created.
    audioEngine.unlock();
    saveAuth(session);
    setAuth(session);
    setIsGuest(false);
    // A registered player's display name IS their username; the server enforces
    // this too (see `GameRoom.onJoin`), so this is just the matching UI.
    setName(session.user.username);
    setScreen("menu");
  }, []);

  const handleGuest = useCallback((guestName: string) => {
    audioEngine.unlock();
    clearAuth();
    setAuth(null);
    setIsGuest(true);
    setName(guestName);
    setScreen("menu");
  }, []);

  const handleSignOut = useCallback(() => {
    clearAuth();
    clearSession();
    setAuth(null);
    setIsGuest(false);
    setName("");
    setScreen("auth");
  }, []);

  // Revalidate a stored token once on load: if it has expired or the account is
  // gone, drop back to the auth screen rather than letting the player discover
  // it only when a join is refused. A held game seat (resume) takes priority
  // and is auth-independent — reconnection bypasses `onAuth` entirely.
  useEffect(() => {
    const stored = loadAuth();
    if (!stored || loadSession(RECONNECT_GRACE_MS)) {
      return;
    }
    let cancelled = false;
    void fetchMe(stored.token).then((user) => {
      if (cancelled) {
        return;
      }
      if (!user) {
        clearAuth();
        setAuth(null);
        setName("");
        setScreen("auth");
      }
    });
    return () => {
      cancelled = true;
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoined = useCallback((joinedRoom: Room<GameState>) => {
    // Also unlocked here, idempotently: a resumed session (see
    // `resumeSession` below) can reach a live room with no click of its own
    // — the auto-reconnect on page load has none — so this is a second,
    // harmless attempt rather than the only one.
    audioEngine.unlock();
    setRoom(joinedRoom);
    // Whatever the server has already told this connection privately. Empty on
    // a fresh join; on a reconnection this is the role and task list that were
    // re-sent before any of this UI existed to listen for them.
    const restored = privateStateFor(joinedRoom);
    setAssignment(restored.role);
    setTasks(restored.tasks ?? []);
    setChat([]);
    setReconnecting(false);
    setScreen(SCREEN_FOR_PHASE[joinedRoom.state.phase] ?? "lobby");
  }, []);

  const returnToMenu = useCallback(() => {
    setRoom(null);
    setAssignment(null);
    setTasks([]);
    setChat([]);
    setReconnecting(false);
    clearSession();
    setScreen("menu");
  }, []);

  const leaveRoom = useCallback(() => {
    leavingRef.current = true;
    void room?.leave();
    returnToMenu();
  }, [room, returnToMenu]);

  /**
   * Chase a dropped connection for as long as the server holds the seat.
   *
   * Every attempt reads the token afresh: a successful reconnection issues a
   * new one, and `loadSession` is also what decides the stored seat has aged
   * out. Giving up drops the player back at the menu with the seat forgotten.
   */
  const resumeSession = useCallback((): Promise<boolean> => {
    if (resumeInFlight.current) {
      return resumeInFlight.current;
    }

    const attempt = (async () => {
      setReconnecting(true);
      const deadline = Date.now() + RECONNECT_GRACE_MS;

      for (;;) {
        const stored = loadSession(RECONNECT_GRACE_MS);
        if (!stored) {
          break;
        }
        try {
          const resumed = await resumeRoom(stored.token, stored.name);
          setName(stored.name);
          handleJoined(resumed);
          return true;
        } catch {
          // The room may simply not have noticed the drop yet, so a first
          // failure is not the end — keep trying until the grace period is up.
          if (Date.now() >= deadline) {
            break;
          }
          await sleep(RECONNECT_RETRY_MS);
        }
      }

      setReconnecting(false);
      clearSession();
      return false;
    })();

    resumeInFlight.current = attempt;
    void attempt.finally(() => {
      resumeInFlight.current = null;
    });
    return attempt;
  }, [handleJoined]);

  // Resume on load. This is what makes closing and reopening the tab a
  // reconnection rather than a fresh start: the seat is still held server-side
  // and the token in storage is what claims it.
  useEffect(() => {
    if (screen !== "resuming") {
      return;
    }
    void resumeSession().then((ok) => {
      if (!ok) {
        // No seat to resume — land on the menu if still signed in, else auth.
        setScreen(loadAuth() ? "menu" : "auth");
      }
    });
    // Intentionally runs once: `screen` only ever starts at "resuming", and
    // re-running on later screen changes would restart the attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendChat = useCallback(
    (text: string) => {
      // Which channel this lands on is the server's call, from whether this
      // player is alive — the client never picks.
      room?.send("chat", { text });
    },
    [room],
  );

  useEffect(() => {
    if (!room) {
      return;
    }

    // The private role message. It is registered here rather than inside the
    // reveal screen because it arrives just *before* the phase flips — the
    // screen that displays it does not exist yet when it lands.
    const offRole: () => void = room.onMessage<RoleAssignment>("role", setAssignment);

    // Same reasoning as the role message: the initial task list is sent in
    // the same server tick that starts the reveal, well before the game
    // screen (and its GameCanvas) exists to receive it directly.
    const offTasks: () => void = room.onMessage<TasksMessage>("tasks", (msg) =>
      setTasks(msg.tasks),
    );
    const offTaskProgress: () => void = room.onMessage<TaskProgressMessage>(
      "taskProgress",
      (msg) => {
        setTasks((prev) =>
          prev.map((task) =>
            task.id === msg.taskId ? { ...task, completedSteps: msg.completedSteps } : task,
          ),
        );
      },
    );

    // Chat arrives on one channel; which lines reach this socket at all is
    // decided server-side by the living/dead split, so everything received
    // here is simply appended — there is nothing to filter out.
    const offChat: () => void = room.onMessage<ChatMessage>("chat", (msg) =>
      setChat((prev) => [...prev, msg]),
    );

    const offCameraReveal: () => void = room.onMessage<CameraRevealMessage>(
      "cameraReveal",
      setCameraReveal,
    );

    const offSilenced: () => void = room.onMessage("silenced", () => setSilenced(true));

    // The server drives every phase transition; the client only follows. That
    // keeps the reveal on screen for the same window for everyone and means a
    // client cannot skip ahead into the world early.
    const unlistenPhase = room.state.listen("phase", (phase) => {
      const next = SCREEN_FOR_PHASE[phase];
      if (next) {
        setScreen(next);
      }
      // "Back to Lobby" lands here — the round is over server-side, so clear
      // everything carried over from it for the next one.
      if (phase === PHASE.LOBBY) {
        setAssignment(null);
        setTasks([]);
        setChat([]);
      }
      // Cleared on the way OUT of a meeting, never on the way in: the
      // server can send this meeting's reveal (or not — only a watchman
      // with an active camera gets one) before this client's state patch
      // for the phase change itself has even arrived, so clearing on entry
      // risks wiping out a reveal that just landed. Clearing on exit means
      // it's already gone by the time the next meeting could send a new one.
      if (phase !== PHASE.MEETING) {
        setCameraReveal(null);
        setSilenced(false);
      }
    });

    const syncCount = () => {
      setPlayerCount(room.state.players.size);
      // The reveal screen's stranger tally is a pure function of the roster
      // size plus these public role and balance settings — kept in sync here
      // so it's already correct the instant the reveal phase begins.
      const ids: string[] = [];
      room.state.enabledRoleIds.forEach((id: string) => ids.push(id));
      setEnabledRoleIds(ids);
      const strangerCount = readRoomSettings(room).strangerCount;
      setStrangerCountOverride(typeof strangerCount === "number" ? strangerCount : 0);
    };
    room.onStateChange(syncCount);
    syncCount();

    /**
     * A deliberate leave is final. Anything else — a closed laptop, a dropped
     * wifi connection, a reloaded tab — is a drop worth chasing, because the
     * server is holding the seat either way and the player would rather be put
     * back in the round than back at the menu.
     */
    const handleLeave = (code: number) => {
      if (leavingRef.current || code === CONSENTED_LEAVE) {
        leavingRef.current = false;
        returnToMenu();
        return;
      }
      void resumeSession().then((ok) => {
        if (!ok) {
          returnToMenu();
        }
      });
    };
    room.onLeave(handleLeave);

    return () => {
      offRole();
      offTasks();
      offTaskProgress();
      offChat();
      offCameraReveal();
      offSilenced();
      unlistenPhase();
      room.onStateChange.remove(syncCount);
      room.onLeave.remove(handleLeave);
    };
  }, [room, returnToMenu, resumeSession]);

  return (
    <div className="app">
      {/*
        Rendered over whatever screen the player was on, never instead of it —
        the world stays visible behind it, so a brief drop reads as a hiccup
        rather than as being thrown out of the game.
      */}
      {(reconnecting || screen === "resuming") && <ReconnectOverlay />}

      {screen === "auth" && (
        <AuthScreen onAuthenticated={handleAuthenticated} onGuest={handleGuest} />
      )}
      {screen === "menu" && (
        <MainMenu
          name={name}
          token={auth?.token ?? null}
          isGuest={isGuest}
          onJoined={handleJoined}
          onSignOut={handleSignOut}
        />
      )}
      {screen === "lobby" && room && <LobbyRoom room={room} onLeave={leaveRoom} />}
      {screen === "reveal" && (
        <RoleReveal
          assignment={assignment}
          playerCount={playerCount}
          enabledRoleIds={enabledRoleIds}
          strangerCountOverride={strangerCountOverride}
        />
      )}
      {screen === "game" && room && (
        <GameView
          room={room}
          tasks={tasks}
          role={assignment?.role ?? null}
          onLeave={leaveRoom}
        />
      )}
      {screen === "meeting" && room && (
        <MeetingScreen
          room={room}
          messages={chat}
          onSendChat={sendChat}
          role={assignment?.role ?? null}
          cameraReveal={cameraReveal}
          silenced={silenced}
        />
      )}
      {screen === "gameOver" && room && <GameOverScreen room={room} />}

      {/* Reachable from every screen past the name prompt, not just the game itself. */}
      {screen !== "auth" && screen !== "resuming" && (
        <button
          type="button"
          className="audio-settings-toggle"
          onClick={() => setShowAudioSettings(true)}
          aria-label={t("audioSettings.heading")}
        >
          🔊
        </button>
      )}
      {screen !== "auth" && screen !== "resuming" && (
        <button
          type="button"
          className="graphics-settings-toggle"
          onClick={() => setShowGraphicsSettings(true)}
          aria-label={t("graphicsSettings.heading")}
        >
          🎨
        </button>
      )}
      {showAudioSettings && (
        <AudioSettingsPanel onClose={() => setShowAudioSettings(false)} />
      )}
      {showGraphicsSettings && (
        <GraphicsSettingsPanel onClose={() => setShowGraphicsSettings(false)} />
      )}
    </div>
  );
}

export default App;
