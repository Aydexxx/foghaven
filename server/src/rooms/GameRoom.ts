import { Room, type Client } from "@colyseus/core";
import {
  applyInput,
  sanitizeDirection,
  strangerCount,
  type Direction,
  type Role,
  TICK_RATE,
  INPUT_RATE,
  SIM_DT,
  MIN_PLAYERS,
  PHASE,
  ROLES,
  ROLE_REVEAL_MS,
} from "@foghaven/shared";
import { GameState, Player } from "./schema/GameState";
import { generateRoomCode, randomSpawn, pickRandom, PLAYER_COLORS } from "./util";

const TICK_INTERVAL_MS = 1000 / TICK_RATE;

/** A single queued input command from a client. */
interface InputCommand {
  seq: number;
  dir: Direction;
}

/** Per-client input state: a bounded queue plus a rate-limiting token budget. */
interface InputState {
  queue: InputCommand[];
  budget: number;
}

/**
 * Cap on buffered inputs per client. Inputs beyond this are dropped (oldest
 * first) so a flooding client cannot grow server memory without bound.
 */
const MAX_QUEUED_INPUTS = INPUT_RATE;

/**
 * Cap on the token budget, in commands. Allows a short catch-up burst after
 * network jitter, but bounds how many inputs a client can bank — which bounds
 * the maximum speed a flooding client can ever achieve to the legitimate rate.
 */
const MAX_INPUT_BUDGET = INPUT_RATE;

export interface JoinOptions {
  name?: string;
}

export class GameRoom extends Room<GameState> {
  override maxClients = 16;

  /** Server-only input buffers, keyed by session id. Never part of the state. */
  private readonly inputs = new Map<string, InputState>();

  /**
   * Secret roles, keyed by session id. This map is the single source of truth
   * for who is what, and it never leaves the server except as the per-client
   * "role" message each player receives about themselves.
   */
  private readonly roles = new Map<string, Role>();

  override onCreate(): void {
    // Replace the framework-generated id with a short, human-readable code.
    // Assigning here (before the room is registered) means the matchmaker and
    // monitor both use this code as the room's id.
    this.roomId = generateRoomCode();

    this.setState(new GameState());

    // The ONLY movement channel: a direction intent plus a sequence number.
    // The server never accepts a position from a client.
    this.onMessage("input", (client, message) => this.enqueueInput(client, message));

    this.onMessage("start", (client) => this.handleStart(client));

    this.setSimulationInterval(() => this.update(), TICK_INTERVAL_MS);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new Player();
    player.id = client.sessionId;
    player.name = options.name?.trim() || `Player-${client.sessionId.slice(0, 4)}`;

    const spawn = randomSpawn();
    player.x = spawn.x;
    player.y = spawn.y;

    player.color = this.pickColor();
    player.alive = true;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { queue: [], budget: 0 });

    // First player in becomes the host.
    if (this.state.hostId === "") {
      this.state.hostId = client.sessionId;
    }
  }

  override onLeave(client: Client): void {
    const leavingId = client.sessionId;
    this.state.players.delete(leavingId);
    this.inputs.delete(leavingId);
    this.roles.delete(leavingId);

    // If the host left, hand the host role to any remaining player.
    if (this.state.hostId === leavingId) {
      const next = this.state.players.keys().next();
      this.state.hostId = next.done ? "" : next.value;
    }
  }

  /**
   * Start the game. Every check here is authoritative: a non-host request, a
   * short-handed room, or a room already past the lobby is silently ignored
   * rather than trusted — the client only ever *requests* a start, this
   * decides whether it actually happens.
   */
  private handleStart(client: Client): void {
    if (this.state.phase !== PHASE.LOBBY) {
      return;
    }
    if (client.sessionId !== this.state.hostId) {
      return;
    }
    if (this.state.players.size < MIN_PLAYERS) {
      return;
    }

    // Deal and deliver the secret roles *before* announcing the phase. Messages
    // and state patches share one socket in order, so every client is holding
    // its own role by the time it learns the reveal has begun.
    this.assignRoles();

    this.state.phase = PHASE.ROLE_REVEAL;

    // A late joiner would have no role and would have missed the reveal, so the
    // room closes for the rest of the game.
    void this.lock();

    this.clock.setTimeout(() => {
      this.state.phase = PHASE.PLAYING;
    }, ROLE_REVEAL_MS);
  }

  /**
   * Deal roles at random and tell each player only what they are entitled to
   * know. The payload is built separately for every client: a stranger learns
   * who their fellow strangers are, a townsfolk receives their own role and an
   * empty list. Nothing about the assignment is written to `state`, so a
   * townsfolk's connection never carries another player's role at all.
   */
  private assignRoles(): void {
    const sessionIds = [...this.state.players.keys()];
    const strangers = new Set(pickRandom(sessionIds, strangerCount(sessionIds.length)));

    this.roles.clear();
    for (const sessionId of sessionIds) {
      this.roles.set(
        sessionId,
        strangers.has(sessionId) ? ROLES.STRANGER : ROLES.TOWNSFOLK,
      );
    }

    for (const client of this.clients) {
      const isStranger = strangers.has(client.sessionId);
      const fellowStrangers = isStranger
        ? [...strangers]
            .filter((id) => id !== client.sessionId)
            .map((id) => this.state.players.get(id)?.name ?? "")
        : [];

      client.send("role", {
        role: isStranger ? ROLES.STRANGER : ROLES.TOWNSFOLK,
        fellowStrangers,
      });
    }
  }

  /**
   * Accept an input command. Everything here is treated as hostile: the
   * sequence number is coerced to an integer and the direction is reduced to a
   * canonical -1/0/1 intent. Any position-like fields the client may include
   * are ignored entirely — position is derived on the server, never received.
   */
  private enqueueInput(client: Client, message: unknown): void {
    const state = this.inputs.get(client.sessionId);
    if (!state) {
      return;
    }

    const raw = (message ?? {}) as { seq?: unknown; dir?: { x?: unknown; y?: unknown } };
    const seq = Number(raw.seq);
    if (!Number.isFinite(seq)) {
      return;
    }

    const dir = sanitizeDirection(raw.dir?.x, raw.dir?.y);
    state.queue.push({ seq: Math.trunc(seq), dir });

    if (state.queue.length > MAX_QUEUED_INPUTS) {
      state.queue.splice(0, state.queue.length - MAX_QUEUED_INPUTS);
    }
  }

  /**
   * Authoritative tick: advance every player's position from their queued
   * inputs. A token budget that refills at the legitimate input rate caps how
   * many commands are processed per second, so flooding inputs cannot buy extra
   * speed. Positions are clamped to the map inside `applyInput`.
   */
  private update(): void {
    this.state.players.forEach((player, sessionId) => {
      const state = this.inputs.get(sessionId);
      if (!state) {
        return;
      }

      state.budget = Math.min(MAX_INPUT_BUDGET, state.budget + INPUT_RATE / TICK_RATE);

      const steps = Math.min(state.queue.length, Math.floor(state.budget));
      if (steps <= 0) {
        return;
      }
      state.budget -= steps;

      let pos = { x: player.x, y: player.y };
      let lastSeq = player.lastSeq;
      for (let i = 0; i < steps; i++) {
        const command = state.queue[i]!;
        pos = applyInput(pos, command.dir, SIM_DT);
        lastSeq = command.seq;
      }
      state.queue.splice(0, steps);

      player.x = pos.x;
      player.y = pos.y;
      player.lastSeq = lastSeq;
    });
  }

  /** Choose a colour not already in use, falling back to the cycle if all taken. */
  private pickColor(): string {
    const used = new Set<string>();
    this.state.players.forEach((p) => used.add(p.color));

    const free = PLAYER_COLORS.find((c) => !used.has(c));
    if (free) {
      return free;
    }

    const index = this.state.players.size % PLAYER_COLORS.length;
    return PLAYER_COLORS[index] ?? PLAYER_COLORS[0];
  }
}
