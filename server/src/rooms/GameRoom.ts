import { Room, type Client } from "@colyseus/core";
import { GameState, Player } from "./schema/GameState";
import { generateRoomCode, randomSpawn, PLAYER_COLORS } from "./util";

/** Server simulation rate: ~20 ticks per second. */
const TICK_RATE_HZ = 20;
const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ;

export interface JoinOptions {
  name?: string;
}

export class GameRoom extends Room<GameState> {
  override maxClients = 16;

  override onCreate(): void {
    // Replace the framework-generated id with a short, human-readable code.
    // Assigning here (before the room is registered) means the matchmaker and
    // monitor both use this code as the room's id.
    this.roomId = generateRoomCode();

    this.setState(new GameState());

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

    // First player in becomes the host.
    if (this.state.hostId === "") {
      this.state.hostId = client.sessionId;
    }
  }

  override onLeave(client: Client): void {
    const leavingId = client.sessionId;
    this.state.players.delete(leavingId);

    // If the host left, hand the role to any remaining player.
    if (this.state.hostId === leavingId) {
      const next = this.state.players.keys().next();
      this.state.hostId = next.done ? "" : next.value;
    }
  }

  /** Per-tick simulation. No movement/game logic yet — lands here later. */
  private update(): void {
    // intentionally empty for the lobby phase
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
