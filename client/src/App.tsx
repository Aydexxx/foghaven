import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  PHASE,
  RECONNECT_GRACE_MS,
  RECONNECT_RETRY_MS,
  USER_ROLE,
  type ChatRejectedMessage,
  type ReportAckMessage,
  type ReportReason,
  type UserRole,
  type CameraRevealMessage,
  type ChatMessage,
  type ClientTask,
  type GameSummaryMessage,
  type RoleAssignment,
  type TaskProgressMessage,
  type TasksMessage,
} from "@foghaven/shared";
import type { GameState } from "./net/types";
import { joinRoomByCode, privateStateFor, resumeRoom } from "./net/client";
import { clearSession, loadSession } from "./net/session";
import { clearAuth, fetchMe, loadAuth, saveAuth, type AuthSession } from "./net/auth";
import { readRoomSettings } from "./net/settings";
import { connectHub, type FriendInviteMessage } from "./net/hub";
import { audioEngine } from "./audio/audioEngine";
import { useGameAudio } from "./audio/useGameAudio";
import { useGameJuice } from "./juice/useGameJuice";
import { useButtonJuice } from "./juice/useButtonJuice";
import { AuthScreen } from "./ui/AuthScreen";
import { MainMenu } from "./ui/MainMenu";
import { LobbyRoom } from "./ui/LobbyRoom";
import { RoleReveal } from "./ui/RoleReveal";
import { MeetingScreen } from "./ui/MeetingScreen";
import { GameOverScreen } from "./ui/GameOverScreen";
import { ReconnectOverlay } from "./ui/ReconnectOverlay";
import { AudioSettingsPanel } from "./ui/AudioSettingsPanel";
import { GraphicsSettingsPanel } from "./ui/GraphicsSettingsPanel";
import { KeybindingSettingsPanel } from "./ui/KeybindingSettingsPanel";
import { LanguageSwitcher } from "./ui/LanguageSwitcher";
import { FriendsPanel } from "./ui/FriendsPanel";
import { FriendInviteToast } from "./ui/FriendInviteToast";
import { ReportDialog } from "./ui/ReportDialog";
import { AdminPanel } from "./ui/AdminPanel";
import { fetchAdminIdentity } from "./net/admin";
import { InventoryPanel } from "./ui/InventoryPanel";
import { ProfilePanel } from "./ui/ProfilePanel";
import { LegalPage } from "./ui/LegalPage";
import { CookieNotice } from "./ui/CookieNotice";
import { VoiceHud } from "./ui/VoiceHud";
import { useVoice } from "./voice/useVoice";
import { useIsTouchDevice } from "./ui/useIsTouchDevice";
import { useFullscreenLandscape } from "./ui/useFullscreenLandscape";
import { LoadingScreen } from "./ui/LoadingScreen";

// Lazy: GameView pulls in GameCanvas, which pulls in Phaser (~1.2MB minified
// on its own) — deferring it until a player actually reaches the game screen
// keeps auth/menu/lobby free of that cost entirely. MeetingScreen has no
// Phaser dependency and stays a static import above.
const GameView = lazy(() => import("./ui/GameView").then((m) => ({ default: m.GameView })));

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

/** Set once the storage-disclosure banner (`CookieNotice`) has been dismissed, so it shows exactly once per browser. */
const COOKIE_NOTICE_SEEN_KEY = "foghaven.cookieNoticeSeen";

/**
 * Client-only retry cadence for `resumeSession`'s early attempts — quick
 * enough that a mobile connection which recovers within a second or two
 * doesn't sit through a full `RECONNECT_RETRY_MS` wait for no reason, then
 * settling to the steady shared interval. Doesn't touch what
 * `RECONNECT_RETRY_MS` means anywhere else.
 */
const RECONNECT_BACKOFF_MS = [500, 1000, 2000];

/**
 * Resolves after `ms`, or immediately if `wakeRef.current()` is invoked first
 * — lets `resumeSession`'s retry loop be cut short by a `visibilitychange`/
 * `online` signal instead of always waiting out its current backoff step.
 */
function waitForWakeOrTimeout(
  ms: number,
  wakeRef: MutableRefObject<(() => void) | null>,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeRef.current = null;
      resolve();
    }, ms);
    wakeRef.current = () => {
      clearTimeout(timer);
      wakeRef.current = null;
      resolve();
    };
  });
}

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
   * Resolves whichever `waitForWakeOrTimeout` call is currently pending in
   * `resumeSession`'s retry loop, if any — set by the `visibilitychange`/
   * `online` listeners below so a backgrounded phone that regains focus or
   * network retries immediately instead of waiting out its current backoff
   * step. Null whenever no retry wait is in flight.
   */
  const wakeResumeRef = useRef<(() => void) | null>(null);
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
  const [showKeybindingSettings, setShowKeybindingSettings] = useState(false);

  // --- Friend system: presence/invites channel, the friends panel, and an
  // invite link's straight-into-the-room join. See `net/hub.ts` and
  // `server/src/rooms/HubRoom.ts` for the always-open connection this
  // drives, and `LobbyRoom`'s "Copy Invite Link" button for where the
  // `?invite=` links this consumes are minted.
  const [hub, setHub] = useState<Room | null>(null);
  const [showFriends, setShowFriends] = useState(false);
  const [incomingInvite, setIncomingInvite] = useState<FriendInviteMessage | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteLinkError, setInviteLinkError] = useState(false);
  /**
   * A room code lifted from `?invite=` on first load, consumed once the
   * player reaches the menu (see the effect below). Read once, eagerly, so
   * the stripping effect right after has something to strip even before any
   * other state has settled.
   */
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("invite"),
  );

  // --- Moderation: reporting, mute feedback, and the admin panel. See
  // `ui/ReportDialog.tsx`, `ui/AdminPanel.tsx` and the server's
  // `moderation/` + `http/adminRoutes.ts`.
  /** Who the report dialog is currently open against, if anyone. */
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  /** A transient line of moderation feedback — report filed, message blocked, muted. */
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  /** Which legal document (if any) is on screen — reachable signed out and signed in, so `App` owns it, not either screen. */
  const [legalDoc, setLegalDoc] = useState<"privacy" | "terms" | null>(null);
  const [showCookieNotice, setShowCookieNotice] = useState(() => {
    try {
      return localStorage.getItem(COOKIE_NOTICE_SEEN_KEY) !== "1";
    } catch {
      return false;
    }
  });
  /**
   * The end-of-game breakdown (roles, task progress, vote history), captured
   * here rather than inside `GameOverScreen` for the same reconnection-timing
   * reason `cameraReveal` is: the server broadcasts it in the same tick
   * `declareGameOver` flips `phase`, which can be before the screen that
   * displays it has mounted to listen.
   */
  const [gameSummary, setGameSummary] = useState<GameSummaryMessage | null>(null);
  /**
   * The caller's moderation role *as the server reports it*, or null for an
   * ordinary player. Confirmed against `/admin/me` rather than read from the
   * stored session, so a tampered `localStorage` cannot conjure the panel —
   * and every route behind it re-checks anyway.
   */
  const [adminRole, setAdminRole] = useState<UserRole | null>(null);

  // Room-level stingers — see the hook's own doc for why this is the one
  // place they live, independent of whichever screen the phase currently
  // has on display.
  useGameAudio(room, assignment?.role ?? null);

  // Room-level §9 juice, mounted alongside the audio for the same reason —
  // a kill has to land for the victim, who is not looking at the world.
  useGameJuice(room);

  // §9's "any button press" row. Room-independent — it covers the menus and
  // the auth screen too, so it sits outside the `room` guard above.
  useButtonJuice();

  // Proximity voice — lives at the app root so the WebRTC mesh survives the
  // game↔meeting screen swaps below rather than being torn down and rebuilt
  // each time. Opt-in: nothing touches the mic until the player joins voice.
  const voice = useVoice(room);

  // Fullscreen + landscape lock, touch devices only, gameplay screens only —
  // see the hook's own doc for why it waits for the player's next tap rather
  // than requesting fullscreen the instant the screen changes.
  const isTouchDevice = useIsTouchDevice();
  const wantsFullscreenLandscape = isTouchDevice && (screen === "game" || screen === "meeting");
  const { toggle: toggleFullscreen } = useFullscreenLandscape(wantsFullscreenLandscape);

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
    setShowFriends(false);
    setIncomingInvite(null);
    setShowAdmin(false);
    setAdminRole(null);
    setReportTarget(null);
    setShowInventory(false);
    setShowProfile(false);
  }, []);

  /** The account was just deleted (GDPR/KVKK erasure) — same teardown as signing out, no account left to return to. */
  const handleAccountDeleted = useCallback(() => {
    handleSignOut();
  }, [handleSignOut]);

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

  // Strip `?invite=` from the address bar the instant it's read (captured
  // above, in `pendingInviteCode`'s initializer) — a reload or a later
  // history entry must not re-trigger the auto-join this state drives below.
  useEffect(() => {
    if (!pendingInviteCode) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
    // Once, on mount — see `pendingInviteCode`'s own initializer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The always-open social connection (presence + friend invites) — held for
  // as long as there's a real account signed in, independent of whichever
  // screen is showing or whether a `GameRoom` is also connected. Guests never
  // get one: `HubRoom.onAuth` requires a real token, and there is nothing
  // for a guest to do here anyway (no account to friend).
  useEffect(() => {
    if (!auth?.token) {
      return;
    }
    let cancelled = false;
    void connectHub(auth.token)
      .then((connected) => {
        if (cancelled) {
          void connected.leave();
          return;
        }
        setHub(connected);
      })
      .catch(() => {
        // Presence/invites are a bonus on top of the core game, not a
        // dependency of it — a hub that fails to connect (server restarting,
        // a momentarily stale token) should never block play.
      });
    return () => {
      cancelled = true;
      setHub((current) => {
        void current?.leave();
        return null;
      });
    };
  }, [auth?.token]);

  // Ask the server whether this account actually has moderation powers. The
  // stored session carries a `role` too, but it is only a hint for rendering —
  // this is the answer that decides whether the panel opens, and the routes
  // behind it check again on every call regardless.
  useEffect(() => {
    if (!auth?.token) {
      setAdminRole(null);
      return;
    }
    let cancelled = false;
    void fetchAdminIdentity(auth.token).then((identity) => {
      if (!cancelled) {
        setAdminRole(identity?.role ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  // Deliver an incoming "come play" the instant it lands, wherever the
  // player currently is.
  useEffect(() => {
    if (!hub) {
      return;
    }
    const off = hub.onMessage<FriendInviteMessage>("friendInvite", (msg) => {
      setIncomingInvite(msg);
    });
    return () => off();
  }, [hub]);

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
    setGameSummary(null);
    setReconnecting(false);
    setScreen(SCREEN_FOR_PHASE[joinedRoom.state.phase] ?? "lobby");
  }, []);

  const returnToMenu = useCallback(() => {
    setRoom(null);
    setAssignment(null);
    setTasks([]);
    setChat([]);
    setGameSummary(null);
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
   * Join through an invite link's carried room code, once there's a name to
   * join with (the menu screen is only ever reached after that's settled —
   * see `screen`'s own state machine). A held reconnection seat takes
   * priority and resolves straight to "lobby"/"game" without ever passing
   * through "menu", so this never fights a resume in progress.
   */
  useEffect(() => {
    if (screen !== "menu" || !pendingInviteCode) {
      return;
    }
    const code = pendingInviteCode;
    setPendingInviteCode(null);
    setInvitePending(true);
    setInviteLinkError(false);
    void joinRoomByCode(name, code, auth?.token ?? null)
      .then((joined) => handleJoined(joined))
      .catch(() => setInviteLinkError(true))
      .finally(() => setInvitePending(false));
    // `handleJoined` is stable (useCallback, empty deps); `name`/`auth` are
    // read at the moment the menu is actually reached, which is exactly
    // once for a given `pendingInviteCode`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, pendingInviteCode]);

  // Transient — the raw join error underneath (bad code, room gone, banned)
  // isn't worth surfacing for a link the player didn't type themselves; this
  // is just "well, that didn't work", cleared after a few seconds either way.
  useEffect(() => {
    if (!inviteLinkError) {
      return;
    }
    const timer = setTimeout(() => setInviteLinkError(false), 4000);
    return () => clearTimeout(timer);
  }, [inviteLinkError]);

  // Moderation feedback is transient the same way the invite-link error is:
  // long enough to read, gone before it becomes clutter.
  useEffect(() => {
    if (!moderationNotice) {
      return;
    }
    const timer = setTimeout(() => setModerationNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [moderationNotice]);

  /** File a report against a player, then close the dialog. */
  const submitReport = useCallback(
    (reason: ReportReason, note: string) => {
      if (!room || !reportTarget) {
        return;
      }
      room.send("report", { targetId: reportTarget.id, reason, note });
      setReportTarget(null);
    },
    [room, reportTarget],
  );

  /**
   * Accept a friend's invite toast — leaves whatever room is currently open
   * (if any) and joins the invited one through the same code-join path a
   * hand-typed code or an invite link takes. A stale invite (the room ended,
   * or filled, by the time this fires) fails quietly: the toast just
   * disappears rather than surfacing a raw join error for a prompt the
   * player didn't type themselves.
   */
  const handleJoinInvite = useCallback(() => {
    if (!incomingInvite) {
      return;
    }
    const roomCode = incomingInvite.roomCode;
    setIncomingInvite(null);
    setInvitePending(true);

    let leaving: Promise<unknown> = Promise.resolve();
    if (room) {
      leavingRef.current = true;
      leaving = room.leave().catch(() => undefined);
    }
    void leaving
      .then(() => joinRoomByCode(name, roomCode, auth?.token ?? null))
      .then((joined) => handleJoined(joined))
      .catch(() => undefined)
      .finally(() => setInvitePending(false));
  }, [incomingInvite, room, name, auth, handleJoined]);

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
      let attemptNumber = 0;

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
          const delay = RECONNECT_BACKOFF_MS[attemptNumber] ?? RECONNECT_RETRY_MS;
          attemptNumber++;
          await waitForWakeOrTimeout(delay, wakeResumeRef);
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

  // Mobile connections drop and recover in bursts (a tab backgrounded while
  // switching apps, wifi handing off to cellular) — nudge a paused retry
  // wait awake the instant the tab regains focus or the network comes back,
  // rather than leaving it to sit out its current backoff step.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        wakeResumeRef.current?.();
      }
    };
    const onOnline = () => wakeResumeRef.current?.();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, []);

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

    const offGameSummary: () => void = room.onMessage<GameSummaryMessage>(
      "gameSummary",
      setGameSummary,
    );

    const offSilenced: () => void = room.onMessage("silenced", () => setSilenced(true));

    // Moderation feedback for things the server refused or acted on. A dropped
    // message needs an explanation — silence would just read as a bug.
    const offChatRejected: () => void = room.onMessage<ChatRejectedMessage>(
      "chatRejected",
      (msg) => {
        setModerationNotice(
          msg.reason === "blocked"
            ? t("moderation.messageBlocked")
            : msg.reason === "muted"
              ? t("moderation.youAreMuted")
              : t("moderation.slowDown"),
        );
      },
    );

    const offReportAck: () => void = room.onMessage<ReportAckMessage>("reportAck", (msg) => {
      setModerationNotice(
        msg.ok
          ? t("moderation.reportFiled")
          : msg.error === "rate_limited"
            ? t("moderation.reportRateLimited")
            : t("moderation.reportFailed"),
      );
    });

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
        setGameSummary(null);
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
      offGameSummary();
      offSilenced();
      offChatRejected();
      offReportAck();
      unlistenPhase();
      room.onStateChange.remove(syncCount);
      room.onLeave.remove(handleLeave);
    };
  }, [room, returnToMenu, resumeSession, t]);

  return (
    <div className="app">
      {/*
        Rendered over whatever screen the player was on, never instead of it —
        the world stays visible behind it, so a brief drop reads as a hiccup
        rather than as being thrown out of the game.
      */}
      {(reconnecting || screen === "resuming") && <ReconnectOverlay />}

      {screen === "auth" && (
        <AuthScreen
          onAuthenticated={handleAuthenticated}
          onGuest={handleGuest}
          onOpenPrivacy={() => setLegalDoc("privacy")}
          onOpenTerms={() => setLegalDoc("terms")}
        />
      )}
      {screen === "menu" && (
        <MainMenu
          name={name}
          token={auth?.token ?? null}
          isGuest={isGuest}
          onJoined={handleJoined}
          onSignOut={handleSignOut}
          onOpenFriends={auth ? () => setShowFriends(true) : undefined}
          onOpenInventory={auth ? () => setShowInventory(true) : undefined}
          onOpenProfile={auth ? () => setShowProfile(true) : undefined}
          notice={inviteLinkError ? t("inviteLink.error") : null}
        />
      )}
      {screen === "lobby" && room && (
        <LobbyRoom
          room={room}
          onLeave={leaveRoom}
          onOpenFriends={auth ? () => setShowFriends(true) : undefined}
        />
      )}
      {screen === "reveal" && (
        <RoleReveal
          assignment={assignment}
          playerCount={playerCount}
          enabledRoleIds={enabledRoleIds}
          strangerCountOverride={strangerCountOverride}
        />
      )}
      {screen === "game" && room && (
        <Suspense fallback={<LoadingScreen />}>
          <GameView
            room={room}
            tasks={tasks}
            role={assignment?.role ?? null}
            onLeave={leaveRoom}
          />
        </Suspense>
      )}
      {screen === "meeting" && room && (
        <MeetingScreen
          room={room}
          messages={chat}
          onSendChat={sendChat}
          role={assignment?.role ?? null}
          cameraReveal={cameraReveal}
          silenced={silenced}
          onReport={auth ? (id, name) => setReportTarget({ id, name }) : undefined}
          onVoteMute={(id) => room.send("vote_mute", { targetId: id })}
        />
      )}
      {screen === "gameOver" && room && (
        <GameOverScreen
          room={room}
          summary={gameSummary}
          onReport={auth ? (id, name) => setReportTarget({ id, name }) : undefined}
        />
      )}

      {/* Proximity voice controls, shown only while voice is live server-side
          (open play and meetings). The mesh itself is driven by `useVoice`
          above, independent of this panel being mounted. */}
      {(screen === "game" || screen === "meeting") && room && (
        <VoiceHud room={room} voice={voice} />
      )}

      {/* Fullscreen/landscape lock — touch devices only, gameplay screens
          only. The rotate overlay's own CSS media query only shows it in
          portrait on a coarse pointer, so it's harmless to always mount here
          rather than threading it through GameView/MeetingScreen. */}
      {wantsFullscreenLandscape && (
        <>
          <div className="rotate-device-overlay">{t("game.rotateDevicePrompt")}</div>
          <button
            type="button"
            className="fullscreen-toggle"
            onClick={toggleFullscreen}
            title={t("game.fullscreenToggle")}
          >
            ⛶
          </button>
        </>
      )}

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
      {screen !== "auth" && screen !== "resuming" && (
        <button
          type="button"
          className="keybinding-settings-toggle"
          onClick={() => setShowKeybindingSettings(true)}
          aria-label={t("keybindingSettings.heading")}
        >
          ⌨️
        </button>
      )}
      <LanguageSwitcher />
      {showAudioSettings && (
        <AudioSettingsPanel onClose={() => setShowAudioSettings(false)} />
      )}
      {showGraphicsSettings && (
        <GraphicsSettingsPanel onClose={() => setShowGraphicsSettings(false)} />
      )}
      {showKeybindingSettings && (
        <KeybindingSettingsPanel onClose={() => setShowKeybindingSettings(false)} />
      )}

      {showFriends && auth && (
        <FriendsPanel
          token={auth.token}
          hub={hub}
          activeRoomCode={room?.roomId ?? null}
          onClose={() => setShowFriends(false)}
        />
      )}

      {/* A friend's invite, delivered live over the hub — see it register in
          the effect above. Shown over whatever screen is up, the same way
          `ReconnectOverlay` is: accepting it can change screens entirely. */}
      {incomingInvite && (
        <FriendInviteToast
          fromUsername={incomingInvite.fromUsername}
          busy={invitePending}
          onJoin={handleJoinInvite}
          onDismiss={() => setIncomingInvite(null)}
        />
      )}

      {reportTarget && (
        <ReportDialog
          targetName={reportTarget.name}
          onSubmit={submitReport}
          onClose={() => setReportTarget(null)}
        />
      )}

      {showAdmin && auth && adminRole && (
        <AdminPanel token={auth.token} role={adminRole} onClose={() => setShowAdmin(false)} />
      )}

      {showInventory && auth && (
        <InventoryPanel
          token={auth.token}
          username={auth.user.username}
          onClose={() => setShowInventory(false)}
        />
      )}

      {showProfile && auth && (
        <ProfilePanel
          token={auth.token}
          username={auth.user.username}
          onClose={() => setShowProfile(false)}
          onOpenPrivacy={() => setLegalDoc("privacy")}
          onOpenTerms={() => setLegalDoc("terms")}
          onAccountDeleted={handleAccountDeleted}
        />
      )}

      {legalDoc && <LegalPage doc={legalDoc} onClose={() => setLegalDoc(null)} />}

      {showCookieNotice && (
        <CookieNotice
          onOpenPrivacy={() => setLegalDoc("privacy")}
          onDismiss={() => {
            setShowCookieNotice(false);
            try {
              localStorage.setItem(COOKIE_NOTICE_SEEN_KEY, "1");
            } catch {
              // Staying dismissed across reloads is a convenience; failing to
              // persist it must never block using the app.
            }
          }}
        />
      )}

      {/* Only rendered once the SERVER has confirmed the role — see the
          `fetchAdminIdentity` effect above. */}
      {adminRole && adminRole !== USER_ROLE.PLAYER && screen !== "auth" && screen !== "resuming" && (
        <button
          type="button"
          className="admin-toggle"
          onClick={() => setShowAdmin(true)}
          aria-label={t("admin.heading")}
        >
          🛡️
        </button>
      )}

      {moderationNotice && (
        <div className="moderation-notice" role="status" aria-live="polite">
          {moderationNotice}
        </div>
      )}

      {/* An invite *link*'s auto-join, in flight — distinct from the toast
          above, which is a friend inviting a player who is already using the
          app. This is the cold-start path: someone with no session yet
          opening a link pasted into Discord. */}
      {invitePending && !incomingInvite && (
        <div className="reconnect-overlay" role="status" aria-live="polite">
          <div className="reconnect-card">
            <p className="reconnect-title">{t("inviteLink.joining")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
