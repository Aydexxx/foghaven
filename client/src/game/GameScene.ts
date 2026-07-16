import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { GameState, PlayerState } from "../net/types";

const PLAYER_RADIUS = 16;
const LABEL_OFFSET_Y = PLAYER_RADIUS + 10;
const FALLBACK_COLOR = 0xffffff;

/** Phaser render objects and change-listener disposers for one player. */
interface PlayerEntity {
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  disposers: Array<() => void>;
}

interface GameSceneData {
  room: Room<GameState>;
}

/**
 * Owns the game world. Renders each networked player as a coloured circle with
 * a name label (placeholder visuals — no art yet). Interpolation of positions
 * lands in a later milestone; for now sprites snap to the authoritative x/y.
 */
export class GameScene extends Phaser.Scene {
  private room!: Room<GameState>;
  private readonly entities = new Map<string, PlayerEntity>();
  private readonly disposers: Array<() => void> = [];
  private torndown = false;

  constructor() {
    super("game");
  }

  init(data: GameSceneData): void {
    this.room = data.room;
  }

  create(): void {
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

    const entity: PlayerEntity = { circle, label, disposers: [] };

    entity.disposers.push(
      player.listen("x", (value) => {
        circle.x = value;
        label.x = value;
      }),
    );
    entity.disposers.push(
      player.listen("y", (value) => {
        circle.y = value;
        label.y = value - LABEL_OFFSET_Y;
      }),
    );
    entity.disposers.push(
      player.listen("name", (value) => {
        label.setText(value);
      }),
    );
    entity.disposers.push(
      player.listen("color", (value) => {
        circle.setFillStyle(this.parseColor(value));
      }),
    );

    this.entities.set(key, entity);
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
