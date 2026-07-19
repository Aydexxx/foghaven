import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  applyInput,
  SIM_DT,
  PLAYER_RADIUS,
  type Direction,
  type Vec2,
} from "@foghaven/shared";
import type { GameState, PlayerState } from "../net/types";

const LABEL_OFFSET_Y = PLAYER_RADIUS + 10;
const FALLBACK_COLOR = 0xffffff;

/** Milliseconds of movement represented by one input command. */
const SIM_DT_MS = SIM_DT * 1000;

/**
 * How far in the past remote players are rendered. The server patches state
 * every 50 ms, so a 100 ms buffer leaves zero slack — one delayed patch
 * empties it and produces a visible catch-up jump. 150 ms covers a full patch
 * interval of jitter while staying an imperceptible delay.
 */
const INTERP_DELAY_MS = 150;

/** Guard against a spiral of death after the tab is backgrounded. */
const MAX_STEPS_PER_FRAME = 5;

/** Keep prediction history bounded if the server ever stops acknowledging. */
const MAX_PENDING = 120;

interface Snapshot extends Vec2 {
  t: number;
}

/** Phaser render objects plus per-player state and listener disposers. */
interface PlayerEntity {
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  disposers: Array<() => void>;
  isLocal: boolean;
  /** Local player only: the client-side predicted position. */
  predicted?: Vec2;
  /** Remote players only: timestamped position snapshots for interpolation. */
  buffer?: Snapshot[];
}

interface InputCommand {
  seq: number;
  dir: Direction;
}

interface GameSceneData {
  room: Room<GameState>;
}

type MoveKeys = Record<
  "W" | "A" | "S" | "D" | "UP" | "DOWN" | "LEFT" | "RIGHT",
  Phaser.Input.Keyboard.Key
>;

/**
 * Owns the game world. The server is authoritative over every position; this
 * scene only ever sends input intents. The local player is client-side
 * predicted and reconciled against the server, while remote players are
 * smoothed with entity interpolation.
 */
export class GameScene extends Phaser.Scene {
  private room!: Room<GameState>;
  private readonly entities = new Map<string, PlayerEntity>();
  private readonly disposers: Array<() => void> = [];
  private torndown = false;

  private keys!: MoveKeys;
  private inputAccumulator = 0;
  private seq = 0;
  private pending: InputCommand[] = [];

  constructor() {
    super("game");
  }

  init(data: GameSceneData): void {
    this.room = data.room;
  }

  create(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as MoveKeys;
      // Stop arrow keys from scrolling the page while playing.
      keyboard.addCapture(["W", "A", "S", "D", "UP", "DOWN", "LEFT", "RIGHT"]);
    }

    const players = this.room.state.players;

    // `onAdd` triggers for players already present, so a joiner immediately
    // sees everyone else in the room.
    this.disposers.push(
      players.onAdd((player, key) => this.addPlayer(player, key)),
    );
    this.disposers.push(
      players.onRemove((_player, key) => this.removePlayer(key)),
    );

    // Tear the state listeners down when this scene goes away. React StrictMode
    // creates and destroys the Phaser game an extra time, and `game.destroy()`
    // emits DESTROY (not always SHUTDOWN); leaving a listener bound to a dead
    // scene would throw inside the schema decoder and break all state updates.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    if (import.meta.env.DEV) {
      (globalThis as unknown as { __foghavenScene?: GameScene }).__foghavenScene = this;
    }
  }

  /** Dev aid: current rendered circle positions, keyed by session id. */
  getRenderedPositions(): Record<string, { x: number; y: number; local: boolean }> {
    const out: Record<string, { x: number; y: number; local: boolean }> = {};
    this.entities.forEach((entity, key) => {
      out[key] = { x: entity.circle.x, y: entity.circle.y, local: entity.isLocal };
    });
    return out;
  }

  override update(_time: number, delta: number): void {
    if (this.torndown) {
      return;
    }

    // Sample input and advance prediction on a fixed timestep, independent of
    // frame rate, so a command always represents exactly SIM_DT of movement.
    this.inputAccumulator += delta;
    let steps = 0;
    while (this.inputAccumulator >= SIM_DT_MS && steps < MAX_STEPS_PER_FRAME) {
      this.sampleAndSend();
      this.inputAccumulator -= SIM_DT_MS;
      steps++;
    }
    if (this.inputAccumulator > SIM_DT_MS * MAX_STEPS_PER_FRAME) {
      this.inputAccumulator = 0;
    }

    this.render();
  }

  private sampleAndSend(): void {
    const local = this.entities.get(this.room.sessionId);
    if (!local?.predicted) {
      return;
    }

    const dir = this.sampleInput();
    if (dir.x === 0 && dir.y === 0) {
      return;
    }

    this.seq += 1;
    local.predicted = applyInput(local.predicted, dir, SIM_DT);
    this.pending.push({ seq: this.seq, dir });
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }

    // Only ever send an intent — never a position.
    this.room.send("input", { seq: this.seq, dir });
  }

  private sampleInput(): Direction {
    const k = this.keys;
    if (!k) {
      return { x: 0, y: 0 };
    }
    const left = k.A.isDown || k.LEFT.isDown;
    const right = k.D.isDown || k.RIGHT.isDown;
    const up = k.W.isDown || k.UP.isDown;
    const down = k.S.isDown || k.DOWN.isDown;
    return {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0),
    };
  }

  private render(): void {
    const renderTime = performance.now() - INTERP_DELAY_MS;

    for (const entity of this.entities.values()) {
      const pos = entity.isLocal
        ? entity.predicted
        : this.interpolate(entity, renderTime);
      if (!pos) {
        continue;
      }
      entity.circle.setPosition(pos.x, pos.y);
      entity.label.setPosition(pos.x, pos.y - LABEL_OFFSET_Y);
    }
  }

  /** Interpolate a remote player between the two snapshots straddling renderTime. */
  private interpolate(entity: PlayerEntity, renderTime: number): Vec2 | null {
    const buffer = entity.buffer;
    if (!buffer || buffer.length === 0) {
      return null;
    }

    // Drop snapshots older than the one immediately before renderTime.
    while (buffer.length >= 2 && buffer[1]!.t <= renderTime) {
      buffer.shift();
    }

    if (buffer.length >= 2) {
      const a = buffer[0]!;
      const b = buffer[1]!;
      const span = b.t - a.t;
      const f = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }

    // Only one snapshot available: hold at the last known position.
    const only = buffer[0]!;
    return { x: only.x, y: only.y };
  }

  private addPlayer(player: PlayerState, key: string): void {
    if (this.torndown || this.entities.has(key)) {
      return;
    }

    const color = this.parseColor(player.color);
    const circle = this.add.circle(player.x, player.y, PLAYER_RADIUS, color);
    circle.setStrokeStyle(2, 0x000000, 0.35);

    const label = this.add
      .text(player.x, player.y - LABEL_OFFSET_Y, player.name, {
        fontFamily: "sans-serif",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5, 1);

    const isLocal = key === this.room.sessionId;
    const entity: PlayerEntity = { circle, label, disposers: [], isLocal };

    if (isLocal) {
      entity.predicted = { x: player.x, y: player.y };
      // Reconcile prediction against every authoritative update.
      entity.disposers.push(player.onChange(() => this.reconcile(player, entity)));
    } else {
      entity.buffer = [{ t: performance.now(), x: player.x, y: player.y }];
      entity.disposers.push(
        player.onChange(() => {
          entity.buffer?.push({ t: performance.now(), x: player.x, y: player.y });
        }),
      );
    }

    entity.disposers.push(
      player.listen("name", (value) => label.setText(value)),
    );
    entity.disposers.push(
      player.listen("color", (value) => circle.setFillStyle(this.parseColor(value))),
    );

    this.entities.set(key, entity);
  }

  /**
   * Snap the local player to the authoritative position, then replay every input
   * the server hasn't acknowledged yet. Because the server and client run the
   * same `applyInput`, the replayed result matches what the player already sees,
   * so this corrects drift without a visible jump.
   */
  private reconcile(player: PlayerState, entity: PlayerEntity): void {
    let pos: Vec2 = { x: player.x, y: player.y };
    this.pending = this.pending.filter((command) => command.seq > player.lastSeq);
    for (const command of this.pending) {
      pos = applyInput(pos, command.dir, SIM_DT);
    }
    entity.predicted = pos;
  }

  private removePlayer(key: string): void {
    const entity = this.entities.get(key);
    if (!entity) {
      return;
    }
    for (const dispose of entity.disposers) {
      dispose();
    }
    entity.circle.destroy();
    entity.label.destroy();
    this.entities.delete(key);
  }

  private teardown(): void {
    if (this.torndown) {
      return;
    }
    this.torndown = true;
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    for (const key of [...this.entities.keys()]) {
      this.removePlayer(key);
    }
  }

  private parseColor(hex: string): number {
    if (!hex) {
      return FALLBACK_COLOR;
    }
    return Phaser.Display.Color.HexStringToColor(hex).color;
  }
}
