import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  FACTION,
  factionOf,
  MIN_PLAYERS,
  PHASE,
  ROLE_REVEAL_MS,
  TICK_RATE,
  TOWN_HALL,
  VOICE_CHANNEL,
  VOICE_MODE,
  type RoleAssignment,
  type VoiceConfigMessage,
  type VoiceRosterMessage,
  type VoiceSignalMessage,
  LOBBY_READY_PAD_POINT,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * The proximity-voice server contract, with the dead/living wall as the
 * headline. The wall here is exactly the same shape as the one on
 * `GameState.players` and the chat channels: the separation is a fact about
 * what the server *sends*, not something the client is trusted to honour. So
 * these tests assert on the raw messages each socket receives — a living
 * client's roster, and whether a cross-wall signal is relayed at all — never on
 * any client-side muting.
 */

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;

beforeAll(async () => {
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("game", GameRoom);
  await gameServer.listen(0);
  const address = (gameServer.transport.server as import("net").Server).address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  (gameServer as unknown as { port: number }).port = port;
  colyseus = new ColyseusTestServer(gameServer);
});

afterAll(async () => {
  if (colyseus) {
    await colyseus.shutdown();
  }
  setAuthProvider(null);
  setFriendProvider(null);
});

afterEach(async () => {
  await colyseus.cleanup();
  authProvider.reset();
  friendProvider.reset();
});

function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let seatCount = 0;

/** Join a client, capturing every voice message it receives for later inspection. */
async function seat(room: ServerRoom<GameState>) {
  const name = `Voicer${++seatCount}`;
  const client = await colyseus.connectTo(room, { name });
  const player = room.state.players.get(client.sessionId)!;

  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (m: RoleAssignment) => roleMessages.push(m));

  const voiceConfigs: VoiceConfigMessage[] = [];
  client.onMessage("voiceConfig", (m: VoiceConfigMessage) => voiceConfigs.push(m));

  const voiceRosters: VoiceRosterMessage[] = [];
  client.onMessage("voiceRoster", (m: VoiceRosterMessage) => voiceRosters.push(m));

  const voiceSignals: VoiceSignalMessage[] = [];
  client.onMessage("voice_signal", (m: VoiceSignalMessage) => voiceSignals.push(m));

  return {
    client,
    player,
    name,
    roleMessages,
    voiceConfigs,
    voiceRosters,
    voiceSignals,
    /** The most recent roster this client received, or undefined if none yet. */
    get roster(): VoiceRosterMessage | undefined {
      return voiceRosters[voiceRosters.length - 1];
    },
  };
}

type Seat = Awaited<ReturnType<typeof seat>>;

async function seatAndPlay(room: ServerRoom<GameState>, count = MIN_PLAYERS): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  // Ready is physical: the start is refused unless MIN_PLAYERS are
  // standing on the Tavern flagstone (see isOnReadyPad).
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
  }
  seats[0]!.client.send("start");
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  return seats;
}

/** Every seat opts into voice; returns once the resulting rosters have settled. */
async function enableVoice(seats: Seat[]): Promise<void> {
  for (const s of seats) {
    s.client.send("voice_ready");
  }
  await tick(3);
}

function splitRoles(seats: Seat[]) {
  return {
    strangers: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.STRANGER),
    townsfolk: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.TOWNSFOLK),
  };
}

function armAbility(room: ServerRoom<GameState>, sessionId: string, abilityId: string): void {
  (room as unknown as { abilityReadyAt: Map<string, number> }).abilityReadyAt.set(
    `${sessionId}:${abilityId}`,
    0,
  );
}

describe("GameRoom voice config", () => {
  it("hands a client STUN/TURN servers when it opts into voice", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    const config = seats[0]!.voiceConfigs[0];
    expect(config).toBeDefined();
    expect(config!.iceServers.length).toBeGreaterThan(0);
    // A STUN server is always present (see `buildIceServers`).
    expect(JSON.stringify(config!.iceServers)).toContain("stun:");
  });
});

describe("GameRoom voice roster", () => {
  it("lists every other voice-ready living player, in proximity mode, during play", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    for (const s of seats) {
      const roster = s.roster!;
      expect(roster.mode).toBe(VOICE_MODE.PROXIMITY);
      expect(roster.channel).toBe(VOICE_CHANNEL.LIVING);
      const expected = seats.filter((o) => o !== s).map((o) => o.client.sessionId).sort();
      expect([...roster.peers].sort()).toEqual(expected);
    }
  });

  it("does not list a peer who has not opted into voice", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    // Everyone but the last opts in.
    const joined = seats.slice(0, -1);
    const holdout = seats[seats.length - 1]!;
    await enableVoice(joined);

    for (const s of joined) {
      expect(s.roster!.peers).not.toContain(holdout.client.sessionId);
    }
  });

  it("switches to equal volume in a meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    // Ring the bell to open a meeting.
    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.MEETING);
    for (const s of seats) {
      expect(s.roster!.mode).toBe(VOICE_MODE.EQUAL);
    }
  });
});

describe("GameRoom voice dead/living wall — covert kill cover + deathMuted", () => {
  /**
   * The headline fix for the 7.9 audit's voice-roster leak: a covert kill
   * (one during PLAYING, not yet reported or swept up by a meeting) must not
   * change ANY living player's roster shape, or a distant client could infer
   * a kill from their peer count dropping by one. The victim keeps
   * appearing, unheard from — `deathMuted` is what silences them, not
   * `peers`. Only once the kill is disclosed (a meeting starts) does the
   * roster catch up to reality.
   */
  it("keeps a covertly killed player in every living roster, muted rather than absent, until disclosed", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const survivor = townsfolk[1]!;
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;

    const rosterBefore = [...survivor.roster!.peers].sort();

    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    expect(victim.player.alive).toBe(false);

    // Every living player's roster is UNCHANGED — same shape, victim still
    // named, nobody told to tear the connection down.
    for (const s of seats) {
      if (s === victim) {
        continue;
      }
      expect(s.roster!.channel).toBe(VOICE_CHANNEL.LIVING);
      expect(s.roster!.peers).toContain(victim.client.sessionId);
      expect(s.roster!.deathMuted).toBe(false);
    }
    expect([...survivor.roster!.peers].sort()).toEqual(rosterBefore);

    // The victim's OWN roster is the tell: real death (channel flips, mic
    // forced off) without the cover changing — they still see the same
    // living peers they did alive, they just cannot be heard.
    expect(victim.roster!.channel).toBe(VOICE_CHANNEL.DEAD);
    expect(victim.roster!.deathMuted).toBe(true);
    for (const s of seats) {
      if (s === victim) {
        continue;
      }
      expect(victim.roster!.peers).toContain(s.client.sessionId);
    }

    // Disclosure: report the body, which starts a meeting. The body's stored
    // position is a snapshot taken at death (see `killPlayer`), so the
    // reporter has to move to where the KILL happened, not to wherever the
    // (now-irrelevant) live victim position is.
    survivor.player.x = killer.player.x;
    survivor.player.y = killer.player.y;
    survivor.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    // NOW the roster catches up: the living lose the victim, the victim's
    // own roster becomes the (empty, alone) graveyard, and the mute directive
    // is no longer needed — the real wall is doing the job instead.
    for (const s of seats) {
      if (s === victim) {
        continue;
      }
      expect(s.roster!.peers).not.toContain(victim.client.sessionId);
    }
    expect(victim.roster!.deathMuted).toBe(false);
    for (const s of seats) {
      expect(victim.roster!.peers).not.toContain(s.client.sessionId);
    }
  });

  it("puts two covertly dead players in the LIVING group during the undisclosed window, then in each other's graveyard once disclosed", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    await enableVoice(seats);

    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const [victimA, victimB] = townsfolk;
    const stillLiving = townsfolk.slice(2);

    for (const victim of [victimA!, victimB!]) {
      victim.player.x = killer.player.x;
      victim.player.y = killer.player.y;
      armAbility(room, killer.client.sessionId, "kill");
      killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
      await tick(3);
    }

    // Undisclosed: the two dead still look exactly like living peers to
    // everyone, including to a genuinely living player's roster — NOT
    // grouped off together, because that grouping is itself the tell.
    for (const s of [...stillLiving, killer]) {
      expect(s.roster!.peers).toContain(victimA!.client.sessionId);
      expect(s.roster!.peers).toContain(victimB!.client.sessionId);
    }
    expect(victimA!.roster!.deathMuted).toBe(true);
    expect(victimB!.roster!.deathMuted).toBe(true);

    // Disclosure via the emergency bell (no body needed for this path).
    const caller = stillLiving[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    // NOW the real wall applies: the two dead hear only each other, and no
    // living player's roster contains either of them.
    expect(victimA!.roster!.peers).toContain(victimB!.client.sessionId);
    expect(victimB!.roster!.peers).toContain(victimA!.client.sessionId);
    expect(victimA!.roster!.deathMuted).toBe(false);
    expect(victimB!.roster!.deathMuted).toBe(false);
    for (const s of seats) {
      if (s === victimA || s === victimB) {
        continue;
      }
      expect(s.roster!.peers).not.toContain(victimA!.client.sessionId);
      expect(s.roster!.peers).not.toContain(victimB!.client.sessionId);
    }
  });

  it("still relays signalling for a covertly dead player during the undisclosed window — the roster is the cover, deathMuted is the enforcement", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const survivor = townsfolk[1]!;
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;

    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    survivor.voiceSignals.length = 0;
    victim.voiceSignals.length = 0;

    // A signal in either direction still goes through — refusing it here,
    // while the victim still visibly appears in `survivor`'s roster, would
    // itself be an observable tell distinguishing a covert kill from an
    // ordinary connection. `deathMuted` (asserted above) is what actually
    // keeps the victim from being heard, not a dropped signal.
    victim.client.send("voice_signal", {
      to: survivor.client.sessionId,
      description: { type: "offer", sdp: "still-connected" },
    });
    survivor.client.send("voice_signal", {
      to: victim.client.sessionId,
      description: { type: "offer", sdp: "still-connected" },
    });
    await tick(3);

    expect(survivor.voiceSignals).toHaveLength(1);
    expect(victim.voiceSignals).toHaveLength(1);
  });

  it("refuses to relay a voice signal from a DISCLOSED-dead player to a living one", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const survivor = townsfolk[1]!;
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;

    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    // Disclose it — the real wall only applies from here. The body's stored
    // position is a snapshot from death (see `killPlayer`), so the reporter
    // moves to the kill site, not to the (now-irrelevant) live victim position.
    survivor.player.x = killer.player.x;
    survivor.player.y = killer.player.y;
    survivor.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    survivor.voiceSignals.length = 0;
    victim.voiceSignals.length = 0;

    // Dead -> living: dropped. This is the whole enforcement — no offer
    // arrives, so no peer connection can ever be negotiated across the wall.
    victim.client.send("voice_signal", {
      to: survivor.client.sessionId,
      description: { type: "offer", sdp: "leak-attempt" },
    });
    // Living -> dead: dropped too.
    survivor.client.send("voice_signal", {
      to: victim.client.sessionId,
      description: { type: "offer", sdp: "leak-attempt" },
    });
    await tick(3);

    expect(survivor.voiceSignals).toHaveLength(0);
    expect(victim.voiceSignals).toHaveLength(0);
  });

  it("relays a voice signal between two living voice peers", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    const [a, b] = seats;
    b!.voiceSignals.length = 0;

    a!.client.send("voice_signal", {
      to: b!.client.sessionId,
      description: { type: "offer", sdp: "v=0 real-offer" },
    });
    await tick(3);

    expect(b!.voiceSignals).toHaveLength(1);
    expect(b!.voiceSignals[0]!.from).toBe(a!.client.sessionId);
    expect((b!.voiceSignals[0]!.description as { sdp: string }).sdp).toBe("v=0 real-offer");
  });
});

describe("GameRoom voice silencer", () => {
  it("tells only the gagged player their mic is off, during the meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    await enableVoice(seats);

    // Open a meeting.
    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    // Gag one living player through the same internal set the Silencer ability
    // drains into (`silencedThisMeeting`), then re-broadcast rosters.
    const gagged = seats[1]!;
    const internals = room as unknown as {
      silencedThisMeeting: Set<string>;
      broadcastVoiceRosters(): void;
    };
    internals.silencedThisMeeting.add(gagged.client.sessionId);
    internals.broadcastVoiceRosters();
    await tick(2);

    expect(gagged.roster!.selfSilenced).toBe(true);
    // Nobody else is told who is silenced — it stays as unobservable as in chat.
    for (const s of seats) {
      if (s !== gagged) {
        expect(s.roster!.selfSilenced).toBe(false);
      }
    }
  });
});
