import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  LOBBY_READY_PAD,
  LOBBY_SETTINGS_TABLE,
  LOBBY_SETTINGS_TABLE_POINT,
  LOBBY_TABLE_RANGE,
  SIM_DT,
  TAVERN_LOBBY_BOUNDS,
  TAVERN_LOBBY_DOORS,
  TILE_SIZE,
  applyLobbyInput,
  isOnReadyPad,
  type Direction,
  type Vec2,
} from "@foghaven/shared";
import type { GameState, PlayerState } from "../net/types";
import { Havener, HAVENER_ATLAS_KEY } from "./characters/Havener";
import { ATLAS_DIR, ATLAS_PAGES } from "../assets/atlasManifest";
import { inputEngine } from "../input/inputEngine";
import { colors } from "../theme/tokens";
import { hexNum } from "../theme/phaserColor";
import { phaserTextStyle } from "../theme/phaserText";

/**
 * The waiting room, as a walkable space rather than a form (ART_BIBLE §5.2:
 * "Tavern (also the lobby)").
 *
 * This is a *presentation* layer over machinery that already existed: the
 * server has always accepted movement input and simulated it during LOBBY,
 * and `GameState.players`'s fog filter has always shown everyone to everyone
 * outside the fog phases. So nothing here needs a new network channel — the
 * scene sends the same `"input"` message `GameScene` does and reads the same
 * `players` map back.
 *
 * Deliberately NOT a mode of `GameScene`. That scene carries tasks, fog,
 * abilities, cutscenes, corpses and the juice director; a lobby needs none of
 * it, and threading a "lobby mode" flag through all of that would make both
 * jobs harder to read. What genuinely is shared — the Havener rig, the input
 * bindings, the prediction maths — is shared by import, which is the part
 * that actually matters for the two staying consistent.
 *
 * Room art doesn't exist yet: every surface below is a flat token-coloured
 * rectangle (§2's "flat fills", §3's palette), sized off the same tile rects
 * the collision grid is built from, so the art pass can replace the fills
 * without moving a single wall.
 */

/** How far above a Havener its nameplate sits. Matches `GameScene`'s. */
const LABEL_OFFSET_Y = 54;
/** The crown/check row sits above the nameplate. */
const MARKER_OFFSET_Y = LABEL_OFFSET_Y + 18;

/** Fixed camera zoom: the whole Tavern, comfortably inside the viewport. */
const CAMERA_ZOOM = 2;

/** Keep prediction history bounded if the server ever stops acknowledging. Mirrors `GameScene`'s. */
const MAX_PENDING = 120;

/** Depth bands, so furniture never draws over a player and markers never draw under one. */
const DEPTH = { floor: 0, furniture: 1, actors: 10, markers: 20, prompt: 30 } as const;

interface LobbyEntity {
  havener: Havener;
  label: Phaser.GameObjects.Text;
  /** The voteGold host crown (§3.4) — created only for the host. */
  crown?: Phaser.GameObjects.Text;
  /** The townGreen ready check — created for everyone, shown while `ready`. */
  check: Phaser.GameObjects.Text;
  /** Shown while the player is inside their reconnection grace period. */
  awayTag: Phaser.GameObjects.Text;
  disposers: Array<() => void>;
  isLocal: boolean;
  /** Local player only: the client-side predicted position. */
  predicted?: Vec2;
  lastPos: Vec2;
}

type KeyMap = Record<
  "up" | "down" | "left" | "right" | "altUp" | "altDown" | "altLeft" | "altRight",
  Phaser.Input.Keyboard.Key
>;

export interface LobbySceneData {
  room: Room<GameState>;
}

export class LobbyScene extends Phaser.Scene {
  private room!: Room<GameState>;
  private entities = new Map<string, LobbyEntity>();
  private disposers: Array<() => void> = [];
  private keys?: KeyMap;
  private eKey?: Phaser.Input.Keyboard.Key;
  private seq = 0;
  private pending: Array<{ seq: number; dir: Direction }> = [];
  private tablePrompt?: Phaser.GameObjects.Text;
  private readyPadFill?: Phaser.GameObjects.Rectangle;
  private nearTable = false;
  private torndown = false;
  /** Translated "Away" copy, pushed in from React — see `setLabels`. */
  private awayLabel = "";
  /**
   * A queued tap from the touch interact button, consumed exactly like a
   * `JustDown` keypress so both paths open the settings the same way.
   */
  private pendingTouchInteract = false;
  private touchDirection: Direction | null = null;

  constructor() {
    super("lobby");
  }

  init(data: LobbySceneData): void {
    this.room = data.room;
  }

  preload(): void {
    // Same atlas, same tolerance as `GameScene`: on a load error the Havener
    // falls back to its placeholder composite, so a checkout that hasn't run
    // `npm run atlas` still shows a walkable, populated lobby. Loaded here
    // too because a Phaser texture cache is per-`Game`, and the lobby runs in
    // its own `Game` instance — `GameCanvas` having loaded it does not make
    // it available over here.
    const page = ATLAS_PAGES[0];
    const json = page.replace(/\.png$/, ".json");
    this.load.atlas(HAVENER_ATLAS_KEY, `/${ATLAS_DIR}/${page}`, `/${ATLAS_DIR}/${json}`);
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === HAVENER_ATLAS_KEY) {
        console.warn("[LobbyScene] Havener atlas not found — using placeholder character. Run `npm run atlas`.");
      }
    });
  }

  create(): void {
    this.torndown = false;
    this.buildRoom();
    this.bindKeys();
    this.disposers.push(inputEngine.subscribe(() => this.bindKeys()));

    // The Tavern fits on screen whole, so the camera is fixed — no follow, no
    // scrolling. A lobby where the camera chased you would hide the very
    // thing this screen exists to show: everyone else in the room.
    const bounds = TAVERN_LOBBY_BOUNDS;
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.centerOn(
      (bounds.x + bounds.w / 2) * TILE_SIZE,
      (bounds.y + bounds.h / 2) * TILE_SIZE,
    );
    this.cameras.main.setBackgroundColor(hexNum(colors.ink));

    // `onAdd` triggers for players already present, so whoever opens the
    // lobby immediately sees everyone already waiting in it.
    const players = this.room.state.players;
    this.disposers.push(players.onAdd((player, key) => this.addPlayer(player, key)));
    this.disposers.push(players.onRemove((_player, key) => this.removePlayer(key)));
    // The host is reassigned whenever the current one leaves
    // (`ensureConnectedHost`), so the crown follows `hostId` rather than
    // being decided once when a player is created.
    this.disposers.push(this.room.state.listen("hostId", () => this.syncHostCrown()));

    const onTouchMove = (dir: Direction | null) => {
      this.touchDirection = dir;
    };
    const onTouchAction = (kind: string) => {
      if (kind === "interact") {
        this.pendingTouchInteract = true;
      }
    };
    this.game.events.on("touch:move", onTouchMove);
    this.game.events.on("touch:action", onTouchAction);
    this.disposers.push(() => {
      this.game.events.off("touch:move", onTouchMove);
      this.game.events.off("touch:action", onTouchAction);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
  }

  override update(): void {
    if (this.torndown) {
      return;
    }
    this.sendInput();
    this.renderPlayers();
    this.updateTablePrompt();
    this.updateReadyPad();
  }

  // --- The room ------------------------------------------------------------

  /**
   * Flat token-coloured shapes standing in for art that doesn't exist yet.
   * Every rect is derived from the same tile geometry the collision grid uses
   * (`TAVERN_LOBBY_BOUNDS`, `LOBBY_*`), so what you see is exactly what you
   * can walk on — there is no second, hand-placed copy of the room to drift.
   */
  private buildRoom(): void {
    const b = TAVERN_LOBBY_BOUNDS;

    // Walls: the outer footprint in ink, with the interior floor laid on top.
    // §2 rule 2 — ink outlines, never pure black.
    this.addRect(b.x, b.y, b.w, b.h, colors.ink, DEPTH.floor);

    // §5.2 Tavern skew: woodMid floor, flameGlow light.
    const interior = { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 };
    this.addRect(interior.x, interior.y, interior.w, interior.h, colors.woodMid, DEPTH.floor);

    // The doorways, drawn as openings onto the dark street beyond. You cannot
    // walk through one while waiting (`applyLobbyInput` confines you to the
    // interior), but seeing them is what makes the flagstone below read as
    // "the marked stone BY THE DOOR" rather than an arbitrary square.
    for (const door of TAVERN_LOBBY_DOORS) {
      this.addRect(door.x, door.y, door.w, door.h, colors.fogDark, DEPTH.floor);
    }

    // The hearth — §5.2's light source for this room — set into the west wall.
    // Its "glow" is a flat translucent ellipse, not a light: `pointlight` is
    // WebGL-only and this game boots with `Phaser.AUTO`, so anything that
    // silently vanishes under the Canvas renderer can't be load-bearing.
    this.addRect(b.x, b.y + 3, 1, 3, colors.flameDeep, DEPTH.furniture);
    this.addRect(b.x + 0.15, b.y + 3.3, 0.7, 2.4, colors.flameGlow, DEPTH.furniture);
    const hearthGlow = this.add.ellipse(
      (b.x + 1) * TILE_SIZE,
      (b.y + 4.5) * TILE_SIZE,
      5 * TILE_SIZE,
      4 * TILE_SIZE,
      hexNum(colors.flameGlow),
      0.1,
    );
    hearthGlow.setDepth(DEPTH.floor);

    // §5.2's signature prop: the long table. Also the settings station.
    const t = LOBBY_SETTINGS_TABLE;
    this.addRect(t.x, t.y, t.w, t.h, colors.woodDark, DEPTH.furniture);
    this.addRect(t.x + 0.12, t.y + 0.12, t.w - 0.24, t.h - 0.24, colors.ropeTan, DEPTH.furniture);

    // The ready flagstone by the plaza door. Stone, ringed in voteGold so it
    // reads as "the marked one" without needing a legend.
    const p = LOBBY_READY_PAD;
    this.addRect(p.x, p.y, p.w, p.h, colors.stoneDark, DEPTH.floor);
    this.readyPadFill = this.addRect(
      p.x + 0.1,
      p.y + 0.1,
      p.w - 0.2,
      p.h - 0.2,
      colors.stoneMid,
      DEPTH.floor,
    );
    const ring = this.add.rectangle(
      (p.x + p.w / 2) * TILE_SIZE,
      (p.y + p.h / 2) * TILE_SIZE,
      p.w * TILE_SIZE - 4,
      p.h * TILE_SIZE - 4,
    );
    ring.setStrokeStyle(3, hexNum(colors.voteGold), 0.9);
    ring.setDepth(DEPTH.floor);

    this.tablePrompt = this.add
      .text(LOBBY_SETTINGS_TABLE_POINT.x, LOBBY_SETTINGS_TABLE_POINT.y - 34, "", {
        ...phaserTextStyle("ui", "caption"),
        color: colors.foam,
        backgroundColor: `${colors.ink}aa`,
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.prompt)
      .setVisible(false);
  }

  /** A tile-space rectangle, in world units, filled with a token colour. */
  private addRect(
    col: number,
    row: number,
    w: number,
    h: number,
    fill: string,
    depth: number,
  ): Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(
      (col + w / 2) * TILE_SIZE,
      (row + h / 2) * TILE_SIZE,
      w * TILE_SIZE,
      h * TILE_SIZE,
      hexNum(fill),
    );
    rect.setDepth(depth);
    return rect;
  }

  // --- Players -------------------------------------------------------------

  private addPlayer(player: PlayerState, key: string): void {
    if (this.torndown || this.entities.has(key)) {
      return;
    }

    const havener = new Havener(this, player.x, player.y, player.lanternColor);
    havener.setDepth(DEPTH.actors);

    const label = this.add
      .text(player.x, player.y - LABEL_OFFSET_Y, player.name, {
        ...phaserTextStyle("ui", "label"),
        color: colors.foam,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.markers);

    // §3.4 townGreen: the ready check. Created for everyone and shown only
    // while the server says they're on the flagstone — the flag is
    // authoritative, so this never guesses from a local position.
    const check = this.add
      .text(player.x, player.y - MARKER_OFFSET_Y, "✓", {
        ...phaserTextStyle("ui", "label"),
        color: colors.townGreen,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.markers)
      .setVisible(player.ready);

    const awayTag = this.add
      .text(player.x, player.y - LABEL_OFFSET_Y + 16, this.awayLabel, {
        ...phaserTextStyle("ui", "caption"),
        color: colors.mist,
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.markers)
      .setVisible(false);

    const isLocal = key === this.room.sessionId;
    const entity: LobbyEntity = {
      havener,
      label,
      check,
      awayTag,
      disposers: [],
      isLocal,
      lastPos: { x: player.x, y: player.y },
    };

    if (isLocal) {
      entity.predicted = { x: player.x, y: player.y };
      entity.disposers.push(player.onChange(() => this.reconcile(player, entity)));
    }

    entity.disposers.push(player.listen("ready", (value) => check.setVisible(value)));
    entity.disposers.push(
      player.listen("connected", (value) => {
        awayTag.setVisible(!value);
        // A dropped player is still holding their seat — draw them faded
        // rather than removing them, so the room can see the seat is taken.
        havener.setAlpha(value ? 1 : 0.4);
        label.setAlpha(value ? 1 : 0.5);
      }),
    );
    entity.disposers.push(player.listen("lanternState", (value) => havener.setLanternState(value)));

    this.entities.set(key, entity);
    this.syncHostCrown();
  }

  private removePlayer(key: string): void {
    const entity = this.entities.get(key);
    if (!entity) {
      return;
    }
    entity.disposers.forEach((dispose) => dispose());
    entity.havener.destroy();
    entity.label.destroy();
    entity.check.destroy();
    entity.awayTag.destroy();
    entity.crown?.destroy();
    this.entities.delete(key);
  }

  /**
   * Give the crown to whoever currently holds `hostId` and to nobody else.
   * Called on every roster change and whenever `hostId` itself moves — the
   * host is reassigned when they leave (`ensureConnectedHost`), so this can't
   * be a one-time decision at creation.
   */
  private syncHostCrown(): void {
    const hostId = this.room.state.hostId;
    this.entities.forEach((entity, key) => {
      const shouldHaveCrown = key === hostId;
      if (shouldHaveCrown && !entity.crown) {
        entity.crown = this.add
          .text(0, 0, "♛", {
            ...phaserTextStyle("ui", "label"),
            color: colors.voteGold,
          })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.markers);
      } else if (!shouldHaveCrown && entity.crown) {
        entity.crown.destroy();
        entity.crown = undefined;
      }
    });
  }

  /**
   * Draw every player at their current position — predicted for the local
   * player, authoritative for everyone else.
   *
   * No interpolation buffer here, unlike `GameScene`. The lobby has no fog to
   * hide a remote player behind and nothing in it is competitive, so a remote
   * Havener simply follows the last position the server sent; the 50ms patch
   * cadence reads as perfectly smooth at walking speed in a room this size,
   * and skipping the buffer keeps this scene's state to one position per
   * player.
   */
  private renderPlayers(): void {
    this.entities.forEach((entity, key) => {
      const player = this.room.state.players.get(key);
      if (!player) {
        return;
      }
      const pos = entity.isLocal && entity.predicted ? entity.predicted : { x: player.x, y: player.y };

      entity.havener.setPosition(pos.x, pos.y);
      entity.label.setPosition(pos.x, pos.y - LABEL_OFFSET_Y);
      entity.check.setPosition(pos.x, pos.y - MARKER_OFFSET_Y);
      entity.awayTag.setPosition(pos.x, pos.y - LABEL_OFFSET_Y + 16);
      entity.crown?.setPosition(pos.x, pos.y - MARKER_OFFSET_Y);
      // Crown and check would collide over a ready host — nudge the crown up.
      if (entity.crown && entity.check.visible) {
        entity.crown.setPosition(pos.x, pos.y - MARKER_OFFSET_Y - 18);
      }

      // Facing and idle/walk come from actual displacement, the same signal
      // `GameScene` uses, so a lobby Havener animates exactly like an in-world one.
      const dx = pos.x - entity.lastPos.x;
      const dy = pos.y - entity.lastPos.y;
      const moving = Math.hypot(dx, dy) > 0.05;
      if (Math.abs(dx) > 0.05) {
        entity.havener.setFacing(dx > 0 ? "right" : "left");
      }
      entity.havener.playState(moving ? "walk" : "idle");
      entity.lastPos = { x: pos.x, y: pos.y };
    });
  }

  // --- Input ---------------------------------------------------------------

  private bindKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }
    keyboard.removeAllKeys(true, true);

    const bindings = inputEngine.getSettings();
    this.keys = {
      up: keyboard.addKey(bindings.moveUp),
      down: keyboard.addKey(bindings.moveDown),
      left: keyboard.addKey(bindings.moveLeft),
      right: keyboard.addKey(bindings.moveRight),
      altUp: keyboard.addKey("UP"),
      altDown: keyboard.addKey("DOWN"),
      altLeft: keyboard.addKey("LEFT"),
      altRight: keyboard.addKey("RIGHT"),
    };
    this.eKey = keyboard.addKey(bindings.interact);

    keyboard.addCapture([
      bindings.moveUp,
      bindings.moveDown,
      bindings.moveLeft,
      bindings.moveRight,
      "UP",
      "DOWN",
      "LEFT",
      "RIGHT",
      bindings.interact,
    ]);
  }

  private sampleInput(): Direction {
    if (this.touchDirection) {
      return this.touchDirection;
    }
    const k = this.keys;
    if (!k) {
      return { x: 0, y: 0 };
    }
    const left = k.left.isDown || k.altLeft.isDown;
    const right = k.right.isDown || k.altRight.isDown;
    const up = k.up.isDown || k.altUp.isDown;
    const down = k.down.isDown || k.altDown.isDown;
    return {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0),
    };
  }

  /**
   * Predict locally, then send the intent — never a position, exactly as in
   * `GameScene`. `applyLobbyInput` is the same function the server runs while
   * the phase is LOBBY, so the Tavern's walls stop the prediction in exactly
   * the place they stop the simulation — including the doorways, which are
   * ordinary walkable tiles the lobby deliberately puts out of bounds.
   */
  private sendInput(): void {
    const local = this.entities.get(this.room.sessionId);
    if (!local?.predicted) {
      return;
    }
    const dir = this.sampleInput();
    this.seq++;
    local.predicted = applyLobbyInput(local.predicted, dir, SIM_DT);
    this.pending.push({ seq: this.seq, dir });
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }
    this.room.send("input", { seq: this.seq, dir });
  }

  /**
   * Snap to the authoritative position and replay whatever the server hasn't
   * acknowledged yet — the same reconciliation `GameScene` performs, and for
   * the same reason: the replay reproduces what the player already sees, so
   * corrections land without a visible jump.
   */
  private reconcile(player: PlayerState, entity: LobbyEntity): void {
    let pos: Vec2 = { x: player.x, y: player.y };
    this.pending = this.pending.filter((command) => command.seq > player.lastSeq);
    for (const command of this.pending) {
      pos = applyLobbyInput(pos, command.dir, SIM_DT);
    }
    entity.predicted = pos;
  }

  // --- The settings table --------------------------------------------------

  /**
   * Show the "press E" prompt near the table and emit an open request on a
   * fresh press. Proximity + E, exactly the idiom `GameScene` uses for task
   * stations — one interaction grammar for the whole game.
   */
  private updateTablePrompt(): void {
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos || !this.tablePrompt) {
      return;
    }

    const inRange =
      Phaser.Math.Distance.Between(
        pos.x,
        pos.y,
        LOBBY_SETTINGS_TABLE_POINT.x,
        LOBBY_SETTINGS_TABLE_POINT.y,
      ) <= LOBBY_TABLE_RANGE;

    this.tablePrompt.setVisible(inRange);
    if (inRange !== this.nearTable) {
      this.nearTable = inRange;
      // The same `prompts:update` contract `GameScene` publishes, so
      // `TouchControls` enables its interact button here with no special
      // casing — the lobby just never reports the other three as available.
      this.game.events.emit("prompts:update", {
        interact: inRange,
        report: false,
        bell: false,
        repair: false,
      });
    }

    const pressed = this.eKey ? Phaser.Input.Keyboard.JustDown(this.eKey) : false;
    const tapped = this.pendingTouchInteract;
    this.pendingTouchInteract = false;
    if (inRange && (pressed || tapped)) {
      this.game.events.emit("lobby:openSettings");
    }
  }

  /**
   * Push translated copy in from React, which owns the i18n catalogue — the
   * scene has none. Called on mount and again on every language change, since
   * the scene outlives a locale switch; `awayLabel` is retained so nameplates
   * created *after* the switch use the current language too.
   */
  setLabels(labels: { tablePrompt: string; away: string }): void {
    this.tablePrompt?.setText(labels.tablePrompt);
    this.awayLabel = labels.away;
    this.entities.forEach((entity) => entity.awayTag.setText(labels.away));
  }

  /**
   * Light the flagstone while the local player stands on it. Driven by the
   * PREDICTED position rather than the server's `ready` flag so the stone
   * responds the instant you step on, with no round-trip — the same shared
   * `isOnReadyPad` the server decides with, so the two can never disagree
   * about where the stone is. The authoritative flag still owns the green
   * checks; this is only the underfoot feedback.
   */
  private updateReadyPad(): void {
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos || !this.readyPadFill) {
      return;
    }
    const standing = isOnReadyPad(pos.x, pos.y);
    this.readyPadFill.setFillStyle(hexNum(standing ? colors.townGreen : colors.stoneMid));
  }

  // --- Teardown ------------------------------------------------------------

  private teardown(): void {
    if (this.torndown) {
      return;
    }
    this.torndown = true;
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    this.entities.forEach((_entity, key) => this.removePlayer(key));
    this.entities.clear();
  }
}
