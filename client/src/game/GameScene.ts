import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  applyInputWithLocks,
  canSee,
  visionRadiusAt,
  roomSlugAt,
  SIM_DT,
  PLAYER_RADIUS,
  TASK_INTERACT_RADIUS,
  KILL_RANGE,
  REPORT_BODY_RANGE,
  BELL_RANGE,
  TOWN_HALL,
  TILE_SIZE,
  TILEMAP_DATA,
  ROOMS,
  MAP,
  TUNNEL_SOUND_RADIUS,
  CRITICAL_REPAIR_POINTS,
  REPAIR_RANGE,
  type ClientTask,
  type CriticalRepairPointId,
  type Direction,
  type TaskProgressMessage,
  type TunnelSoundMessage,
  type Vec2,
  type AbilityTargetKind,
} from "@foghaven/shared";
import type { BodyState, GameState, PlayerState } from "../net/types";
import i18n from "../i18n";
import {
  ACCESSORY_VISUALS,
  DEATH_EFFECT_VISUALS,
  HAT_VISUALS,
  OUTFIT_VISUALS,
  PET_VISUALS,
} from "./characters/cosmeticVisuals";
import { Havener, HAVENER_ATLAS_KEY, type HavenerState } from "./characters/Havener";
import { lanternHexForColor } from "./characters/playerLantern";
import type { AnchorName } from "./characters/anchors";
import { ATLAS_DIR, ATLAS_PAGES } from "../assets/atlasManifest";
import { audioEngine } from "../audio/audioEngine";
import { PhaseAtmosphere } from "./atmosphere/PhaseAtmosphere";
import { inputEngine } from "../input/inputEngine";
import { graphicsEngine } from "../graphics/graphicsEngine";
import { displayColorFor, playerColorIndex } from "../graphics/colorBlindPalette";
import { fonts, fontStacks } from "../theme/tokens";
import { phaserTextStyle } from "../theme/phaserText";

/** How far below the character's name sits above their head — clears even the alderman's top hat. */
const LABEL_OFFSET_Y = 54;
/**
 * The small player-colour badge that rides beside the sprite for at-a-glance
 * identity — see `createAccentBadge`. Large enough (8, not the original 4)
 * to fit the legible number glyph every badge now carries regardless of
 * color-blind mode — see that setting's doc comment on why color alone,
 * even a well-chosen palette, isn't sufficient on its own.
 */
const BADGE_RADIUS = 8;
/** Chest height — clear of every archetype's head (which sits above y ≈ -30) and low enough to read as a pin, not a growth on the neck. */
const BADGE_OFFSET: Vec2 = { x: 9, y: -18 };
/** Below this speed (world units/frame-independent — see usage) a player reads as standing still. */
const MOVEMENT_EPSILON = 0.05;
/** World units of walking between spatial footstep triggers — a plausible stride at `PLAYER_SPEED`. */
const FOOTSTEP_STEP_DISTANCE = 75;

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

const TASK_MARKER_SIZE = 18;
const TASK_MARKER_COLOR = 0xffd166;
const TASK_LABEL_OFFSET_Y = TASK_MARKER_SIZE;

/** How see-through a ghost looks to other ghosts. */
const GHOST_ALPHA = 0.4;

/**
 * Cosmetic slot → §4.3 anchor it attaches to on the Havener. This is the only
 * mapping of loadout fields to anchors; the anchor offsets themselves live
 * solely in `characters/anchors.ts`.
 */
type CosmeticSlot = "hat" | "accessory" | "outfit" | "pet";
const COSMETIC_ANCHOR: Record<CosmeticSlot, AnchorName> = {
  hat: "crown",
  accessory: "face",
  outfit: "chest",
  pet: "feet",
};
/** Placeholder rectangle sizes per slot, in §4 128-source units (real art swaps in later). */
const COSMETIC_PLACEHOLDER_SIZE: Record<CosmeticSlot, { w: number; h: number }> = {
  hat: { w: 22, h: 10 },
  accessory: { w: 14, h: 6 },
  outfit: { w: 8, h: 12 },
  pet: { w: 12, h: 10 },
};
/** Reused catalogs, only to colour each placeholder with the equipped item's own accent. */
const COSMETIC_CATALOG: Record<CosmeticSlot, Readonly<Record<string, { fill: number }>>> = {
  hat: HAT_VISUALS,
  accessory: ACCESSORY_VISUALS,
  outfit: OUTFIT_VISUALS,
  pet: PET_VISUALS,
};
const COSMETIC_PLACEHOLDER_FALLBACK = Phaser.Display.Color.GetColor(150, 150, 160);

const TOWN_HALL_MARKER_SIZE = 28;
const TOWN_HALL_MARKER_COLOR = 0x8899ff;

/** A critical repair point's marker: red while broken, green once fixed. */
const REPAIR_MARKER_SIZE = 24;
const REPAIR_MARKER_BROKEN_COLOR = 0xdb4b3c;
const REPAIR_MARKER_FIXED_COLOR = 0x4bb35c;

/** Tile colours for the procedurally generated tileset — see `createTilemap`. */
const TILE_COLOR_WALL = 0x14141c;
const TILE_COLOR_STREET = 0x4a4a5c;
const TILE_COLOR_ROOM = 0x5c4a38;
const TILESET_KEY = "town-tiles";

/** How the room signage reads compared to a task's location label. */
const ROOM_LABEL_COLOR = "#8f8fae";
const ROOM_LABEL_STYLE = phaserTextStyle("ui", "caption");

/** How smoothly the camera chases the local player — 1 would be instant. */
const CAMERA_LERP = 0.15;

/**
 * How long a remote player may go without an update before they are treated
 * as fogged and hidden. The server force-refreshes every position it is
 * willing to send at every patch (50 ms — see the fog heartbeat in
 * `GameRoom.update`), so silence is not ambiguity: an entity that has gone
 * quiet for several patch intervals is one the server is deliberately
 * withholding. This is how the client knows to stop drawing someone without
 * ever being told — Colyseus retracts nothing when a filter closes, it just
 * goes quiet.
 */
const VISIBILITY_TIMEOUT_MS = 350;

/** The fog overlay: colour, how dark it gets, and how softly it moves. */
const FOG_COLOR = 0x05070d;
const FOG_MAX_ALPHA = 0.94;
/** Size of the pre-rendered radial-gradient brush texture, in pixels. */
const FOG_BRUSH_SIZE = 512;
const FOG_BRUSH_KEY = "fog-brush";
/** Per-frame lerp rates for the fog's radius and darkness transitions. */
const FOG_RADIUS_RATE = 0.08;
const FOG_FADE_RATE = 0.06;
/** Draw order: above the world and its actors, below nothing that matters. */
const FOG_DEPTH = 50;

interface Snapshot extends Vec2 {
  t: number;
}

/** One task marker's render objects, plus the mutable progress it reflects. */
interface TaskMarker {
  task: ClientTask;
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/** A corpse's render objects. Bodies are public, so everyone draws these. */
interface BodyEntity {
  circle: Phaser.GameObjects.Arc;
  cross: Phaser.GameObjects.Text;
}

/** Phaser render objects plus per-player state and listener disposers. */
interface PlayerEntity {
  /**
   * The §4 layered composite. Owns z0–z7 (pet…glowOverlay) and every
   * equipped cosmetic, which now attach to the container's anchors rather
   * than riding as separate world-space overlays — see `setHavenerCosmetic`.
   */
  havener: Havener;
  label: Phaser.GameObjects.Text;
  /** The small player-colour badge riding along beside the sprite — see `createAccentBadge`. */
  badge: Phaser.GameObjects.Arc;
  /** The badge's number glyph — always shown, regardless of color-blind mode; see that setting's doc comment. */
  badgeNumber: Phaser.GameObjects.Text;
  /** The equipped death-effect catalog id, if any — captured for `playDeathTransition` to read at the moment it fires. */
  deathEffectId?: string;
  disposers: Array<() => void>;
  isLocal: boolean;
  /** Local player only: the client-side predicted position. */
  predicted?: Vec2;
  /** Remote players only: timestamped position snapshots for interpolation. */
  buffer?: Snapshot[];
  /**
   * When this player's data last arrived from the server. The fog filter
   * retracts nothing — it just goes quiet — so recency IS visibility: see
   * `VISIBILITY_TIMEOUT_MS`. Remote players start at 0 (hidden until the
   * server actually says they're here), the local player at Infinity
   * (always fresh, always drawn).
   */
  lastFreshAt: number;
  /** Whether the fog currently lets this player be drawn. */
  fogVisible: boolean;
  /** Last position used to derive movement (idle vs walk) and facing (flip). */
  lastPos?: Vec2;
  /** True while the sprite is showing the one-shot fall — see `playDeathTransition`. */
  deathPlaying: boolean;
  /** World units walked since the last footstep audio trigger — see `updateFootstepAudio`. */
  footstepDistance: number;
  /** Whether this entity currently has a footstep voice registered with the audio engine. */
  hasFootstepVoice: boolean;
}

interface InputCommand {
  seq: number;
  dir: Direction;
}

/** One PLAYING-phase ability the local role has, and how to gather its target. */
export interface AbilitySlotInfo {
  ability: string;
  targetKind: AbilityTargetKind;
}

interface GameSceneData {
  room: Room<GameState>;
  /** Initial task list seed — see the prop doc on `GameCanvasProps.tasks`. */
  tasks: ClientTask[];
  /**
   * The local player's own role's PLAYING-phase abilities (meeting-phase
   * ones — Alderman, Constable, Assassin — render entirely inside
   * `MeetingScreen` instead, same as before). Fixed for the whole round,
   * since a role never changes mid-game. Empty for a role with no ability at
   * all.
   */
  abilitySlots: AbilitySlotInfo[];
}

/** One player, body, or room the local player could currently act on — see `getAbilityTarget`. */
export interface AbilityTargetInfo {
  kind: AbilityTargetKind;
  /** Session id — a player for `"player"`, a body for `"body"`. */
  id?: string;
  name?: string;
  /** A room slug, for `"room"`. */
  room?: string;
}

/** A one-shot action a touch button can trigger — see `"touch:action"` on the game event emitter. */
export type TouchActionKind = "interact" | "report" | "bell";

/**
 * Whether each proximity prompt is currently showing, published every frame
 * (change-detected) so on-screen touch buttons know when to enable/highlight
 * themselves — the touch equivalent of the "press E/R/B" text prompts already
 * drawn in the world. Keyed the same as the four `update*Prompt` methods.
 */
export interface PromptVisibility {
  interact: boolean;
  report: boolean;
  bell: boolean;
  repair: boolean;
}

/**
 * Keyed by logical direction rather than literal key name, since `up`/`down`/
 * `left`/`right` are rebindable (see `input/inputEngine.ts`) — only
 * `altUp`/`altDown`/`altLeft`/`altRight` (the arrow keys) are a fixed,
 * always-on alternate, never part of the rebindable settings surface at all.
 */
type MoveKeys = Record<
  "up" | "down" | "left" | "right" | "altUp" | "altDown" | "altLeft" | "altRight",
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
  private eKey!: Phaser.Input.Keyboard.Key;
  private rKey!: Phaser.Input.Keyboard.Key;
  private bKey!: Phaser.Input.Keyboard.Key;
  private inputAccumulator = 0;
  private seq = 0;
  private pending: InputCommand[] = [];

  /**
   * The virtual joystick's current direction, set via the `"touch:move"`
   * game event, already quantized to the same -1/0/1-per-axis shape as
   * `sampleInput()`'s keyboard output — the server's `sanitizeDirection`
   * collapses anything else to that shape anyway (see shared/game/movement.ts),
   * so sending a true free-angle vector would only desync client prediction
   * from what the server actually resolves. Null means "no touch input
   * active", in which case keyboard state is used instead.
   */
  private touchDirection: Direction | null = null;
  /** A queued touch tap, consumed at most once by whichever prompt is showing — see `consumeTouchAction`. */
  private pendingTouchAction: TouchActionKind | null = null;
  /** Last prompt visibility emitted to React, so `"prompts:update"` only fires on change — same pattern as `lastPublishedAbilityTargetKey`. */
  private lastPublishedPromptKey: string | null = null;

  private readonly taskMarkers = new Map<string, TaskMarker>();
  private initialTasks: ClientTask[] = [];
  private interactPrompt?: Phaser.GameObjects.Text;
  private reportPrompt?: Phaser.GameObjects.Text;
  private bellPrompt?: Phaser.GameObjects.Text;
  private townHallRect?: Phaser.GameObjects.Rectangle;
  private tilemapLayer?: Phaser.Tilemaps.TilemapLayer;
  private readonly roomLabels: Phaser.GameObjects.Text[] = [];
  /** The two critical-sabotage repair point markers, hidden until one is active. */
  private readonly repairMarkers = new Map<CriticalRepairPointId, Phaser.GameObjects.Rectangle>();
  private repairPrompt?: Phaser.GameObjects.Text;

  /**
   * The fog visual: a screen-space darkness with a soft-edged hole erased
   * around the local player each frame. Presentation only — what actually
   * keeps distant players secret is the server never sending them (see the
   * `filterChildren` on the server's `GameState`); this overlay just makes
   * the world look the way the data already behaves.
   */
  private fogOverlay?: Phaser.GameObjects.RenderTexture;
  private fogBrush?: Phaser.GameObjects.Image;
  /** Colour grade, light bleed, ambient particles, puddles and screen shake — see the class doc. */
  private atmosphere!: PhaseAtmosphere;
  /** Starts at 0 so the world irises open on spawn. */
  private fogRadius = 0;
  private fogAlpha = FOG_MAX_ALPHA;
  /**
   * True while a mini-game modal is open on the React side. Movement input
   * and the "press E" prompt both freeze during this — see `update()`.
   */
  private taskModalOpen = false;

  private readonly bodies = new Map<string, BodyEntity>();
  /**
   * Whether the local player is dead. Ghosts are drawn semi-transparently for
   * other ghosts; the living never receive them at all, so there is nothing
   * for this flag to hide.
   */
  private localIsGhost = false;
  /** Last targets emitted to React, as a stable key, so we only emit on change. */
  private lastPublishedAbilityTargetKey: string | null = null;
  /** The local role's PLAYING-phase abilities — see `GameSceneData`. */
  private abilitySlots: AbilitySlotInfo[] = [];

  constructor() {
    super("game");
  }

  init(data: GameSceneData): void {
    this.room = data.room;
    this.initialTasks = data.tasks;
    this.abilitySlots = data.abilitySlots;
  }

  preload(): void {
    // The Havener's body art comes from the 7.3 atlas (already the .clean.png
    // versions of the approved sprites). Its absence is tolerated: on a
    // FILE_LOAD_ERROR the Havener falls back to a full placeholder composite,
    // so a checkout that hasn't run `npm run atlas` still renders and plays —
    // this task is architecture-first, and the structure must not depend on
    // the art being present.
    const page = ATLAS_PAGES[0];
    const json = page.replace(/\.png$/, ".json");
    this.load.atlas(HAVENER_ATLAS_KEY, `/${ATLAS_DIR}/${page}`, `/${ATLAS_DIR}/${json}`);
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === HAVENER_ATLAS_KEY) {
        console.warn("[GameScene] Havener atlas not found — using placeholder character. Run `npm run atlas`.");
      }
    });
  }

  create(): void {
    this.bindKeys();
    // Live rebind: the settings panel writes straight through `inputEngine`
    // while this scene may already be running, so picking up a change
    // without waiting for the next room join means actually re-running key
    // setup, not just re-reading fields that were only ever assigned once.
    this.disposers.push(inputEngine.subscribe(() => this.bindKeys()));
    // Live re-tint: same reasoning, for the color-blind palette toggle.
    this.disposers.push(graphicsEngine.subscribe(() => this.applyColorBlindPalette()));

    // Drawn first so every other game object (players, task markers, the
    // town hall marker) naturally layers on top of it — Phaser stacks same-
    // depth objects in creation order.
    this.createTilemap();
    // Constructed here — right after the tile layer, before room labels or
    // any player exists — so its puddle decals (default depth, no explicit
    // z) land in the same "layers above ground, below everything else"
    // creation-order stack this comment already relies on. Its other pieces
    // (colour grade, light glows, particles) use explicit depths and don't
    // care where in this sequence they're built.
    this.atmosphere = new PhaseAtmosphere(this);
    this.disposers.push(
      this.room.state.listen("sabotageActive", (active) => this.atmosphere.setSabotageActive(active)),
    );
    // The Stranger's tunnel is "never fully invisible" — a sound broadcasts
    // to every client (not fog-filtered) at both fixed endpoints; each
    // client independently decides whether it's close enough to hear it.
    this.disposers.push(
      this.room.onMessage<TunnelSoundMessage>("tunnelSound", (message) =>
        this.playTunnelSoundIfAudible(message),
      ),
    );
    this.createRoomLabels();

    // The world is far bigger than the viewport; the camera follows the
    // local player around it once they exist (see `addPlayer`) and is
    // fenced to the map's own edges so it never shows off-map void.
    this.cameras.main.setBounds(0, 0, MAP.width, MAP.height);

    this.createTownHallMarker();
    this.createRepairMarkers();
    this.createFogOverlay();
    this.createTaskMarkers(this.initialTasks);
    // Progress after the initial seed flows through here, independent of the
    // React `tasks` prop — see the doc on `GameSceneData.tasks`.
    this.disposers.push(
      this.room.onMessage<TaskProgressMessage>("taskProgress", (message) =>
        this.applyTaskProgress(message),
      ),
    );

    // The React/Phaser bridge for mini-games: this scene decides WHEN a task
    // opens (proximity + E, still checked here) and emits it on the Game's
    // global emitter — GameCanvas relays that up to React, which renders the
    // actual mini-game and reports back on the same channel when it's done.
    // See GameCanvas.tsx for the other half of this bridge.
    const onTaskClose = () => {
      this.taskModalOpen = false;
    };
    this.game.events.on("task:close", onTaskClose);
    this.disposers.push(() => this.game.events.off("task:close", onTaskClose));

    // Touch input bridge: `TouchControls` (React) emits these on the same
    // game-level emitter used for the mini-game bridge above. See the
    // `touchDirection`/`pendingTouchAction` field docs.
    const onTouchMove = (dir: Direction | null) => {
      this.touchDirection = dir;
    };
    const onTouchAction = (action: TouchActionKind) => {
      this.pendingTouchAction = action;
    };
    this.game.events.on("touch:move", onTouchMove);
    this.game.events.on("touch:action", onTouchAction);
    this.disposers.push(() => this.game.events.off("touch:move", onTouchMove));
    this.disposers.push(() => this.game.events.off("touch:action", onTouchAction));

    const players = this.room.state.players;

    // `onAdd` triggers for players already present, so a joiner immediately
    // sees everyone else in the room.
    this.disposers.push(
      players.onAdd((player, key) => this.addPlayer(player, key)),
    );
    this.disposers.push(
      players.onRemove((_player, key) => this.removePlayer(key)),
    );

    // Bodies are public state — every client, living or dead, draws them.
    const bodies = this.room.state.bodies;
    this.disposers.push(bodies.onAdd((body, key) => this.addBody(body, key)));
    this.disposers.push(bodies.onRemove((_body, key) => this.removeBody(key)));

    // An ejected player leaves no body, so the graveyard is the only signal
    // that they're gone. Without this their sprite would linger for the
    // living exactly the way a killed player's used to.
    this.disposers.push(
      this.room.state.deadPlayerIds.onAdd((id: string) => this.onPlayerConfirmedDead(id)),
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

  /**
   * Dev aid: current rendered sprite positions, keyed by session id.
   * `visible` is the sprite's own draw state (`fresh` in `render()`) — the
   * ground truth for "is this entity actually being shown right now", as
   * distinct from merely being a (possibly stale) key in `this.entities` or
   * in `room.state.players`: Colyseus never retracts a key once a filter has
   * let it through once, so `.has()` alone can't tell a currently-visible
   * entity from a stale one the fog has since hidden again.
   */
  getRenderedPositions(): Record<string, { x: number; y: number; local: boolean; visible: boolean }> {
    const out: Record<string, { x: number; y: number; local: boolean; visible: boolean }> = {};
    this.entities.forEach((entity, key) => {
      out[key] = {
        x: entity.havener.x,
        y: entity.havener.y,
        local: entity.isLocal,
        visible: entity.havener.visible,
      };
    });
    return out;
  }

  override update(_time: number, delta: number): void {
    if (this.torndown) {
      return;
    }

    // Freeze movement and task interaction while a mini-game modal is open —
    // the player is looking at a React overlay, not the world.
    if (!this.taskModalOpen) {
      // Sample input and advance prediction on a fixed timestep, independent
      // of frame rate, so a command always represents exactly SIM_DT of
      // movement.
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
    }

    this.render();
    this.renderFog();
    this.atmosphere.update(delta);

    if (this.taskModalOpen) {
      this.interactPrompt?.setVisible(false);
      this.reportPrompt?.setVisible(false);
      this.bellPrompt?.setVisible(false);
      this.repairPrompt?.setVisible(false);
      this.publishPromptVisibility({ interact: false, report: false, bell: false, repair: false });
    } else {
      const interact = this.updateTaskInteraction();
      const report = this.updateReportPrompt();
      const bell = this.updateBellPrompt();
      const repair = this.updateRepairPrompt();
      this.publishPromptVisibility({ interact, report, bell, repair });
    }

    this.updateCommsVisibility();
    this.publishAbilityTarget();
  }

  /**
   * Push the current target for every PLAYING-phase ability the local role
   * has up to React (which owns the ability buttons), but only when
   * something actually changed — this runs every frame.
   */
  private publishAbilityTarget(): void {
    const targets: Record<string, AbilityTargetInfo | null> = {};
    for (const slot of this.abilitySlots) {
      targets[slot.ability] = this.taskModalOpen ? null : this.getAbilityTarget(slot.targetKind);
    }
    const key = this.abilitySlots
      .map((slot) => {
        const target = targets[slot.ability];
        return `${slot.ability}:${target ? `${target.kind}:${target.id ?? target.room ?? ""}` : ""}`;
      })
      .join("|");
    if (key === this.lastPublishedAbilityTargetKey) {
      return;
    }
    this.lastPublishedAbilityTargetKey = key;
    this.game.events.emit("ability:targets", targets);
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
    local.predicted = applyInputWithLocks(
      local.predicted,
      dir,
      SIM_DT,
      this.lockedRoomSlugsSnapshot(),
    );
    this.pending.push({ seq: this.seq, dir });
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }

    // Only ever send an intent — never a position.
    this.room.send("input", { seq: this.seq, dir });
  }

  /**
   * (Re-)binds every keyboard control from `inputEngine`'s current settings.
   * Called once from `create()` and again on every live rebind (see the
   * `inputEngine.subscribe` call there) — `removeAllKeys(true, true)`
   * destroys and un-captures whatever was bound before, so a rebind can
   * never leave a stale key object listening or double-capture a key that
   * moved from one action to another.
   */
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
      // Always-on alternate, independent of the rebindable settings above.
      altUp: keyboard.addKey("UP"),
      altDown: keyboard.addKey("DOWN"),
      altLeft: keyboard.addKey("LEFT"),
      altRight: keyboard.addKey("RIGHT"),
    };
    this.eKey = keyboard.addKey(bindings.interact);
    this.rKey = keyboard.addKey(bindings.report);
    this.bKey = keyboard.addKey(bindings.bell);

    // Stop these keys from scrolling/otherwise acting on the page while playing.
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
      bindings.report,
      bindings.bell,
    ]);
  }

  /** Re-tints every already-created badge and corpse marker after the color-blind palette toggle changes — new entities already pick it up at creation. */
  private applyColorBlindPalette(): void {
    const colorBlindMode = graphicsEngine.getSettings().colorBlindMode;
    this.entities.forEach((entity, key) => {
      const player = this.room.state.players.get(key);
      if (player) {
        entity.badge.setFillStyle(this.parseColor(displayColorFor(player.color, colorBlindMode)));
      }
    });
    this.bodies.forEach((bodyEntity, key) => {
      const body = this.room.state.bodies.get(key);
      if (body) {
        bodyEntity.circle.setFillStyle(this.parseColor(displayColorFor(body.color, colorBlindMode)));
      }
    });
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
   * Consume a queued touch tap for `kind`, at most once. Called alongside
   * `Phaser.Input.Keyboard.JustDown(...)` in each proximity prompt so a touch
   * button and its keyboard shortcut trigger the exact same code path.
   */
  private consumeTouchAction(kind: TouchActionKind): boolean {
    if (this.pendingTouchAction !== kind) {
      return false;
    }
    this.pendingTouchAction = null;
    return true;
  }

  /**
   * Push current prompt visibility to React (for `TouchControls`' button
   * enabled/highlight state), but only when something changed — same
   * change-detection shape as `publishAbilityTarget`.
   */
  private publishPromptVisibility(visibility: PromptVisibility): void {
    const key = `${visibility.interact}|${visibility.report}|${visibility.bell}|${visibility.repair}`;
    if (key === this.lastPublishedPromptKey) {
      return;
    }
    this.lastPublishedPromptKey = key;
    this.game.events.emit("prompts:update", visibility);
  }

  private render(): void {
    const now = performance.now();
    const renderTime = now - INTERP_DELAY_MS;
    const localPos = this.entities.get(this.room.sessionId)?.predicted;

    // Ambience is purely a function of where the local player's own body
    // currently stands — ghosts included, they still perceive the town
    // around them. `setRoom` itself no-ops when the room hasn't changed.
    if (localPos) {
      audioEngine.setRoom(roomSlugAt(localPos.x, localPos.y));
    }

    for (const [id, entity] of this.entities) {
      if (!entity.isLocal) {
        // Recency is visibility — see `VISIBILITY_TIMEOUT_MS`. A stale
        // entity is one the server has stopped sending: its last known
        // position may be seconds out of date, so drawing it would show a
        // phantom standing where someone no longer is.
        const wasFogVisible = entity.fogVisible;
        const fresh = now - entity.lastFreshAt < VISIBILITY_TIMEOUT_MS;
        if (fresh && !wasFogVisible && entity.buffer && entity.buffer.length > 1) {
          // Re-emerging from the fog: drop the stale interpolation history
          // so they pop in where they are, rather than sliding there from
          // wherever they were last seen.
          entity.buffer = entity.buffer.slice(-1);
        }
        entity.fogVisible = fresh;
        // The composite (body + every attached cosmetic) is one container, so
        // one visibility toggle covers them all — no per-cosmetic bookkeeping.
        entity.havener.setVisible(fresh);
        entity.badge.setVisible(fresh);
        entity.badgeNumber.setVisible(fresh);
        entity.label.setVisible(fresh);
        if (!fresh) {
          // Leaving fog is exactly leaving earshot too — same principle as
          // the position sync itself never sending what's out of range.
          if (wasFogVisible && entity.hasFootstepVoice) {
            audioEngine.removeFootstepSource(id);
            entity.hasFootstepVoice = false;
          }
          continue;
        }
      }

      const pos = entity.isLocal
        ? entity.predicted
        : this.interpolate(entity, renderTime);
      if (!pos) {
        continue;
      }
      // One position drives the whole composite — its feet sit on `pos`
      // (the container's local origin is the feet anchor), and every cosmetic
      // rides along as a child. The nameplate/badge stay world-space siblings
      // (§4.2 keeps the nameplate upright and unmirrored — never a child).
      entity.havener.setPosition(pos.x, pos.y);
      entity.badge.setPosition(pos.x + BADGE_OFFSET.x, pos.y + BADGE_OFFSET.y);
      entity.badgeNumber.setPosition(pos.x + BADGE_OFFSET.x, pos.y + BADGE_OFFSET.y);
      entity.label.setPosition(pos.x, pos.y - LABEL_OFFSET_Y);
      // Read before `updateCharacterAnimation` overwrites `entity.lastPos`
      // to `pos` at its end.
      this.updateFootstepAudio(id, entity, pos, localPos);
      this.updateCharacterAnimation(id, entity, pos);
    }
  }

  /**
   * Spatial footsteps: a persistent pan/distance/muffle voice per audible
   * remote player (see `audio/synth/footstep.ts`), fed a burst every
   * `FOOTSTEP_STEP_DISTANCE` of actual walked movement.
   *
   * Eligibility is deliberately narrow — remote, currently fog-visible
   * (never local, never anyone the fog is already hiding), and alive (a
   * drifting ghost doesn't step). That fog gate is not a nicety: `pos` here
   * is only ever a position this client's socket was already sent, so a
   * source that failed the eligibility check was never going to leak
   * anything by being skipped — the same guarantee the visual fog relies
   * on, applied to the audio channel instead of the render loop.
   *
   * "Direction" is left/right stereo pan and "distance" is loudness plus
   * how muffled the burst sounds, both normalised against the *listener's*
   * current vision radius (`visionRadiusAt`) — so footstep range always
   * matches how far the listener can presently see, indoors or out.
   */
  private updateFootstepAudio(
    id: string,
    entity: PlayerEntity,
    pos: Vec2,
    localPos: Vec2 | undefined,
  ): void {
    const eligible = !entity.isLocal && entity.fogVisible && !!localPos && !this.isDeadPlayer(id);
    if (!eligible) {
      if (entity.hasFootstepVoice) {
        audioEngine.removeFootstepSource(id);
        entity.hasFootstepVoice = false;
      }
      return;
    }
    entity.hasFootstepVoice = true;

    const toDx = pos.x - localPos!.x;
    const toDy = pos.y - localPos!.y;
    const radius = visionRadiusAt(localPos!);
    const proximity = Math.max(0, 1 - Math.hypot(toDx, toDy) / radius);
    const pan = Math.max(-1, Math.min(1, toDx / radius));
    audioEngine.updateFootstepSpatial(id, pan, proximity);

    const prev = entity.lastPos ?? pos;
    const stepDistance = Math.hypot(pos.x - prev.x, pos.y - prev.y);
    if (stepDistance <= MOVEMENT_EPSILON) {
      return;
    }
    entity.footstepDistance += stepDistance;
    if (entity.footstepDistance >= FOOTSTEP_STEP_DISTANCE) {
      entity.footstepDistance %= FOOTSTEP_STEP_DISTANCE;
      audioEngine.triggerFootstep(id);
    }
  }

  /**
   * Choose which loop this character should be showing right now — idle,
   * walking, working a task, or drifting as a ghost — and which way they
   * face. Facing is derived purely from horizontal movement (no facing
   * exists server-side to read), and only ever flips on a real horizontal
   * step so a player moving straight up or down keeps whichever way they
   * were last walking rather than snapping to a default.
   *
   * The one-shot death fall (`playDeathTransition`) is deliberately left
   * alone here — this only manages the four looping states, and stays out
   * of the way for as long as `entity.deathPlaying` is set.
   */
  private updateCharacterAnimation(id: string, entity: PlayerEntity, pos: Vec2): void {
    const prev = entity.lastPos ?? pos;
    const dx = pos.x - prev.x;
    const dy = pos.y - prev.y;
    entity.lastPos = pos;

    if (Math.abs(dx) > MOVEMENT_EPSILON) {
      // §4.5: two-direction facing, the side art mirrored. Only a real
      // horizontal step flips it, so vertical-only movement holds the last
      // facing rather than snapping to a default.
      entity.havener.setFacing(dx < 0 ? "left" : "right");
    }

    if (entity.deathPlaying) {
      return;
    }

    const state: HavenerState = this.isDeadPlayer(id)
      ? "ghost"
      : id === this.room.sessionId && this.taskModalOpen
        ? "task"
        : Math.hypot(dx, dy) > MOVEMENT_EPSILON
          ? "walk"
          : "idle";

    entity.havener.playState(state);
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

    // §4.1: one identical Havener for everyone. Identity is the lantern's
    // colour (§3.5), derived from the player's already-public `color` — no new
    // network field, and it can never correlate with the one thing that is
    // actually secret (their role). See `playerLantern.ts` for the §3.5 debt
    // note on why that colour is not yet a unique per-player identity.
    const havener = new Havener(this, player.x, player.y, lanternHexForColor(player.color));

    const badge = this.add.circle(
      player.x + BADGE_OFFSET.x,
      player.y + BADGE_OFFSET.y,
      BADGE_RADIUS,
      this.parseColor(displayColorFor(player.color, graphicsEngine.getSettings().colorBlindMode)),
    );
    badge.setStrokeStyle(1.5, 0x000000, 0.5);

    // Always shown, regardless of color-blind mode: the same number always
    // pairs with the same color for a given player (their stable index into
    // PLAYER_COLORS), reinforcing rather than replacing the color cue — this
    // is what actually disambiguates two players whose colors happen to hash
    // onto the same character archetype shape, which a palette swap alone
    // cannot fix. See graphics/colorBlindPalette.ts.
    const badgeNumber = this.add
      .text(player.x + BADGE_OFFSET.x, player.y + BADGE_OFFSET.y, String(playerColorIndex(player.color) + 1), {
        // Below the §7 "nothing under 13px" floor, deliberately: this glyph
        // is a reinforcing cue packed inside an 8px-radius badge (see the
        // comment above), not text a player reads for information — bumping
        // it to caption(13) would blow out the badge geometry. Still uses
        // the numeric family/weight, since it is literally a counter.
        fontFamily: fontStacks.numeric,
        fontSize: "9px",
        fontStyle: String(fonts.numeric.weight),
        color: "#000000",
      })
      .setOrigin(0.5, 0.5);

    const label = this.add
      .text(player.x, player.y - LABEL_OFFSET_Y, player.name, {
        ...phaserTextStyle("ui", "label"),
        color: "#ffffff",
      })
      .setOrigin(0.5, 1);

    const isLocal = key === this.room.sessionId;
    const entity: PlayerEntity = {
      havener,
      label,
      badge,
      badgeNumber,
      disposers: [],
      isLocal,
      lastFreshAt: isLocal ? Number.POSITIVE_INFINITY : 0,
      fogVisible: isLocal,
      deathPlaying: false,
      footstepDistance: 0,
      hasFootstepVoice: false,
    };

    if (isLocal) {
      entity.predicted = { x: player.x, y: player.y };
      // Reconcile prediction against every authoritative update.
      entity.disposers.push(player.onChange(() => this.reconcile(player, entity)));
      // The world is bigger than the screen; follow whoever this client is
      // playing as, smoothed rather than pinned so small corrections (like
      // reconciliation snaps) don't visibly jerk the camera.
      this.cameras.main.startFollow(havener, true, CAMERA_LERP, CAMERA_LERP);
    } else {
      // Hidden until the server actually delivers them: a remote entry can
      // be a stale relic (the fog retracts nothing), so existence in the
      // state map is not proof of presence — a fresh update is.
      havener.setVisible(false);
      badge.setVisible(false);
      badgeNumber.setVisible(false);
      label.setVisible(false);
      entity.buffer = [{ t: performance.now(), x: player.x, y: player.y }];
      entity.disposers.push(
        player.onChange(() => {
          entity.buffer?.push({ t: performance.now(), x: player.x, y: player.y });
          entity.lastFreshAt = performance.now();
        }),
      );
    }

    entity.disposers.push(
      player.listen("name", (value) => label.setText(value)),
    );
    entity.disposers.push(
      // A colour change — which never happens today, but the schema allows it
      // — moves the identity badge AND re-tints the lantern, since §3.5 makes
      // the lantern the carrier of that identity (`playerLantern.ts`).
      player.listen("color", (value) => {
        badge.setFillStyle(this.parseColor(displayColorFor(value, graphicsEngine.getSettings().colorBlindMode)));
        badgeNumber.setText(String(playerColorIndex(value) + 1));
        havener.setLanternColor(lanternHexForColor(value));
      }),
    );

    // Cosmetics arrive slightly after the player itself: `GameRoom.onJoin`
    // snapshots the account's equipped loadout onto these fields
    // fire-and-forget (see its own doc), so they are very often still empty
    // strings at the exact moment this entity is created. `listen` is what
    // catches the patch once it lands — there is no reactive "changed mid-
    // room" case to handle beyond that, since a loadout is fixed for the
    // room's lifetime the same way `name` is.
    entity.disposers.push(
      player.listen("hatId", (value) => this.setHavenerCosmetic(entity, "hat", value)),
    );
    entity.disposers.push(
      player.listen("accessoryId", (value) => this.setHavenerCosmetic(entity, "accessory", value)),
    );
    entity.disposers.push(
      player.listen("outfitId", (value) => this.setHavenerCosmetic(entity, "outfit", value)),
    );
    entity.disposers.push(
      player.listen("petId", (value) => this.setHavenerCosmetic(entity, "pet", value)),
    );
    // Not an overlay — read at the moment `playDeathTransition` fires, so it
    // only needs capturing, not rendering.
    entity.disposers.push(
      player.listen("deathEffectId", (value) => {
        entity.deathEffectId = value;
      }),
    );

    this.entities.set(key, entity);
    // Liveness comes from the bodies map, not `player.alive` — see
    // `isDeadPlayer` for why that flag is unreliable on living clients.
    this.applyGhostStyle(entity, !this.isDeadPlayer(key));
  }

  /**
   * Ghosts render translucent. This only ever applies to *other ghosts* seen
   * by a ghost — a living client is never sent a dead player in the first
   * place, so this is presentation, not concealment.
   */
  private applyGhostStyle(entity: PlayerEntity, alive: boolean): void {
    // The composite owns its own ghost look (§4.4: translucent, dark lantern)
    // via its ghost state; here we drive it and handle the two world-space
    // siblings the container never contains — the badge (hidden for ghosts)
    // and the nameplate.
    entity.badge.setAlpha(alive ? 1 : 0);
    entity.label.setAlpha(alive ? 1 : GHOST_ALPHA);
    entity.havener.playState(alive ? "idle" : "ghost");
  }

  /**
   * Attach, swap, or clear one cosmetic slot on the Havener, addressed by its
   * §4.3 anchor (hat→crown, accessory→face, outfit→chest, pet→feet). Swapping
   * replaces only that slot; sibling layers and the container are untouched.
   *
   * The visual is a placeholder rectangle tinted with the catalog entry's own
   * accent colour (so a hat swap is visibly a *different* hat) — the existing
   * `cosmeticVisuals` polygons are authored in the OLD rig's coordinate space
   * and cannot be reused here at the §4 128-source scale. Real per-anchor
   * cosmetic art is a swap-in later, exactly like the sliced body layers, with
   * no change to this attach mechanism.
   */
  private setHavenerCosmetic(entity: PlayerEntity, slot: CosmeticSlot, id: string): void {
    const anchor = COSMETIC_ANCHOR[slot];
    if (!id) {
      entity.havener.detach(anchor);
      return;
    }
    const size = COSMETIC_PLACEHOLDER_SIZE[slot];
    const color = COSMETIC_CATALOG[slot][id]?.fill ?? COSMETIC_PLACEHOLDER_FALLBACK;
    const rect = this.add.rectangle(0, 0, size.w, size.h, color);
    entity.havener.attach(anchor, rect);
  }

  /**
   * The one-shot death, played exactly once at the moment this client learns
   * a specific player has just died — see the three call sites in `addBody`
   * / `onPlayerConfirmedDead` / `becomeGhost`. While it plays, the per-frame
   * animation selector in `render` leaves the composite alone (see
   * `entity.deathPlaying`); when the Havener reports the settle done, it hands
   * off to the looping ghost drift.
   *
   * The death here is the minimal placeholder settle: the full §4.4 sequence
   * — the squash-and-fall and the signature detaching, rolling lantern whose
   * glow fades out — is the 7.6 task and lives inside `Havener.playDeath`.
   */
  private playDeathTransition(entity: PlayerEntity): void {
    if (entity.deathPlaying) {
      return;
    }
    entity.deathPlaying = true;
    if (entity.deathEffectId) {
      this.spawnDeathEffect(entity.deathEffectId, entity.havener.x, entity.havener.y);
    }
    entity.havener.playDeath(() => {
      entity.deathPlaying = false;
      entity.havener.playState("ghost");
    });
  }

  /**
   * A one-shot cosmetic flourish at the moment a death fall starts —
   * whatever the dying player has equipped in the death-effect slot. Purely
   * decorative timing: by the time this fires, the server has already
   * resolved the kill and told this client about it (via `addBody` /
   * `onPlayerConfirmedDead` / `becomeGhost`, the three call sites of
   * `playDeathTransition`), so nothing here can affect who died or when.
   * A handful of small circles tweened outward and faded — deliberately not
   * a real `ParticleEmitter`: one short burst doesn't need pooling, and this
   * avoids depending on Phaser's particle API shape across versions.
   */
  private spawnDeathEffect(cosmeticId: string, x: number, y: number): void {
    const visual = DEATH_EFFECT_VISUALS[cosmeticId];
    if (!visual) {
      return;
    }
    for (let i = 0; i < visual.particleCount; i += 1) {
      const angle = (i / visual.particleCount) * Math.PI * 2 + Math.random() * 0.6;
      const distance = visual.spread * (0.6 + Math.random() * 0.4);
      const particle = this.add.circle(x, y - 10, 1.5 + Math.random(), visual.color, 0.9);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y - 10 + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.3,
        duration: 450 + Math.random() * 200,
        ease: "Cubic.easeOut",
        onComplete: () => particle.destroy(),
      });
    }
  }

  /**
   * Whether a player is dead, from the two unfiltered public signals.
   *
   * A player's own `alive` flag is not usable here: the server's per-child
   * filter stops sending a dead player to living clients at the very moment
   * `alive` flips, so the living never receive that flip and their stale copy
   * reads `alive: true` forever.
   *
   * Bodies cover deaths during play. `deadPlayerIds` covers the rest — it
   * survives the body clearing that happens at every meeting, and an ejected
   * player never leaves a body at all.
   */
  private isDeadPlayer(id: string): boolean {
    return this.room.state.bodies.has(id) || this.room.state.deadPlayerIds.includes(id);
  }

  private addBody(body: BodyState, key: string): void {
    if (this.torndown || this.bodies.has(key)) {
      return;
    }
    const circle = this.add.circle(
      body.x,
      body.y,
      PLAYER_RADIUS,
      this.parseColor(displayColorFor(body.color, graphicsEngine.getSettings().colorBlindMode)),
    );
    circle.setStrokeStyle(3, 0x000000, 0.6);
    circle.setAlpha(0.75);
    const cross = this.add
      .text(body.x, body.y, "✕", {
        ...phaserTextStyle("ui", "label"),
        color: "#000000",
      })
      .setOrigin(0.5, 0.5);

    this.bodies.set(key, { circle, cross });

    if (body.playerId === this.room.sessionId) {
      this.becomeGhost();
      return;
    }

    if (this.localIsGhost) {
      // We are a ghost, so we keep seeing them — restyle them as one and
      // play their fall, since this is this client's first word of it.
      const entity = this.entities.get(body.playerId);
      if (entity) {
        this.applyGhostStyle(entity, false);
        this.playDeathTransition(entity);
      }
      audioEngine.playStinger("bodyFound");
      this.atmosphere.shakeBodyFound();
      return;
    }

    // We are alive. The server has just stopped sending this player to us,
    // which would otherwise leave their sprite frozen on top of their own
    // corpse — and would let a stranger target a dead player. Drop it.
    this.removePlayer(body.playerId);
    // A body entering *our own* fog is a witnessed kill or a fresh
    // discovery either way — the victim and killer already got the "kill"
    // stinger privately (see `useGameAudio`'s "killed"/"killConfirmed"
    // handling); this is the cue for everyone else this body just became
    // visible to.
    audioEngine.playStinger("bodyFound");
    this.atmosphere.shakeBodyFound();
  }

  /**
   * A player has been publicly confirmed dead (a graveyard entry). Mirrors
   * `addBody`'s handling, which is the other way this can happen.
   */
  private onPlayerConfirmedDead(id: string): void {
    if (this.torndown) {
      return;
    }

    if (id === this.room.sessionId) {
      if (!this.localIsGhost) {
        this.becomeGhost();
      }
      return;
    }

    if (this.localIsGhost) {
      const entity = this.entities.get(id);
      if (entity) {
        this.applyGhostStyle(entity, false);
        this.playDeathTransition(entity);
      }
      return;
    }

    // We're alive, so the server has stopped sending them to us; drop the
    // sprite rather than leave it frozen where they last stood.
    this.removePlayer(id);
  }

  /**
   * Called when the local player's own body appears. From here on the server
   * sends us everyone — every ghost, and every living player the fog used to
   * hide. Colyseus only streams *changes*, so the sprites rebuilt here start
   * from whatever stale entries we still hold; the fog heartbeat (every
   * position, every patch — see `GameRoom.update`) has them all fresh within
   * a patch interval, at which point the staleness gate in `render` unhides
   * them and the fog overlay itself dissolves (see `renderFog`).
   */
  private becomeGhost(): void {
    this.localIsGhost = true;

    const local = this.entities.get(this.room.sessionId);
    if (local) {
      this.playDeathTransition(local);
    }

    this.room.state.players.forEach((player, key) => {
      if (!this.entities.has(key)) {
        this.addPlayer(player, key);
      }
      const entity = this.entities.get(key);
      if (entity) {
        // Every OTHER ghost here is a resync, not a new death — they may
        // have died long before this client could see them. Only the local
        // player's own fall above is a live transition worth animating.
        this.applyGhostStyle(entity, !this.isDeadPlayer(key));
      }
    });
  }

  private removeBody(key: string): void {
    const body = this.bodies.get(key);
    if (!body) {
      return;
    }
    body.circle.destroy();
    body.cross.destroy();
    this.bodies.delete(key);
  }

  /**
   * The current target for the local player's own ability, by target kind —
   * purely a hint for the UI (which button shows, and whether it's enabled);
   * the server independently re-derives and re-validates everything about
   * an ability attempt before it does anything. `"none"` always reports
   * available (no target to gather); `"player"`/`"body"`/`"room"` each
   * follow the same "nearest thing in range, in fog, in sight" shape the
   * kill button always has.
   */
  getAbilityTarget(kind: AbilityTargetKind): AbilityTargetInfo | null {
    if (kind === "none") {
      return { kind: "none" };
    }
    if (this.localIsGhost) {
      return null;
    }
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos) {
      return null;
    }

    if (kind === "player") {
      const target = this.nearestPlayerTarget(pos);
      return target && { kind: "player", id: target.id, name: target.name };
    }
    if (kind === "body") {
      const bodyId = this.findNearestBody(pos);
      if (!bodyId) {
        return null;
      }
      const body = this.room.state.bodies.get(bodyId);
      return { kind: "body", id: bodyId, name: body?.name ?? "?" };
    }
    // "room": Watchman bugs wherever they currently stand — no proximity
    // search needed, just the tile the local player is on right now.
    return { kind: "room", room: roomSlugAt(pos.x, pos.y) };
  }

  /**
   * Play the tunnel's entry/exit stinger only if the local player is
   * currently close enough to either endpoint — `TUNNEL_SOUND_RADIUS` is
   * deliberately wider than sight, since a sound isn't blocked by walls the
   * way sight is. The broadcast itself carries no information about who
   * used the tunnel, only that something happened at these two fixed,
   * already-public map points.
   */
  private playTunnelSoundIfAudible(message: TunnelSoundMessage): void {
    const pos = this.entities.get(this.room.sessionId)?.predicted;
    if (!pos) {
      return;
    }
    const audible = message.points.some(
      (point) => Phaser.Math.Distance.Between(pos.x, pos.y, point.x, point.y) <= TUNNEL_SOUND_RADIUS,
    );
    if (audible) {
      audioEngine.playStinger("tunnel");
    }
  }

  /** The nearest living player within `KILL_RANGE`, in fog, in range — shared by kill and protect. */
  private nearestPlayerTarget(pos: Vec2): { id: string; name: string } | null {
    let best: { id: string; name: string } | null = null;
    let bestDistance = KILL_RANGE;

    for (const [id, entity] of this.entities) {
      if (id === this.room.sessionId || this.isDeadPlayer(id)) {
        continue;
      }
      // No targeting into the fog: a hidden entity is a stale relic, not a
      // player standing there. (The server re-checks range and line of
      // sight regardless — this just keeps the button honest.)
      if (!entity.fogVisible) {
        continue;
      }
      const player = this.room.state.players.get(id);
      if (!player) {
        continue;
      }
      const distance = Phaser.Math.Distance.Between(pos.x, pos.y, entity.havener.x, entity.havener.y);
      if (distance <= bestDistance) {
        best = { id, name: player.name };
        bestDistance = distance;
      }
    }

    return best;
  }

  /**
   * Builds the town's tile grid into an actual Phaser tilemap. The data and
   * the tile-kind-to-index mapping both come from `@foghaven/shared` — the
   * exact same grid `applyInput` collides against on both client and server
   * — so what gets drawn and what gets enforced can never drift apart.
   *
   * There is no tileset image asset; one is generated on the fly from three
   * flat colours (wall / street / room floor). That keeps the map data-driven
   * and asset-free rather than tying it to art that doesn't exist yet.
   */
  private createTilemap(): void {
    if (!this.textures.exists(TILESET_KEY)) {
      const gfx = this.add.graphics();
      gfx.fillStyle(TILE_COLOR_WALL).fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      gfx.fillStyle(TILE_COLOR_STREET).fillRect(TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
      gfx.fillStyle(TILE_COLOR_ROOM).fillRect(TILE_SIZE * 2, 0, TILE_SIZE, TILE_SIZE);
      gfx.generateTexture(TILESET_KEY, TILE_SIZE * 3, TILE_SIZE);
      gfx.destroy();
    }

    const map = this.make.tilemap({
      data: TILEMAP_DATA,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0);
    this.tilemapLayer = tileset ? (map.createLayer(0, tileset, 0, 0) ?? undefined) : undefined;
  }

  /** Ambient wayfinding signage — one label per room, at its interior center. */
  private createRoomLabels(): void {
    for (const room of ROOMS) {
      const label = this.add
        .text(room.center.x, room.center.y, i18n.t(`rooms.${room.slug}`), {
          ...ROOM_LABEL_STYLE,
          color: ROOM_LABEL_COLOR,
        })
        .setOrigin(0.5, 0.5)
        .setAlpha(0.8);
      this.roomLabels.push(label);
    }
  }

  /**
   * The visual "stand here" marker for the emergency bell — deliberately
   * unlabelled. The building it sits in front of already carries a "Town
   * Hall" sign from `createRoomLabels`; a second copy of the same text
   * floating in the plaza would just be noise.
   */
  private createTownHallMarker(): void {
    this.townHallRect = this.add
      .rectangle(TOWN_HALL.x, TOWN_HALL.y, TOWN_HALL_MARKER_SIZE, TOWN_HALL_MARKER_SIZE, TOWN_HALL_MARKER_COLOR)
      .setStrokeStyle(2, 0x000000, 0.5);
  }

  /**
   * The two critical-sabotage repair points, at the Lighthouse's fixed
   * coordinates from the shared registry. Created once, hidden until a
   * critical sabotage is actually active (see `updateRepairPrompt`) —
   * there's nothing to repair the rest of the game.
   */
  private createRepairMarkers(): void {
    for (const [id, point] of Object.entries(CRITICAL_REPAIR_POINTS) as Array<
      [CriticalRepairPointId, Vec2]
    >) {
      const marker = this.add
        .rectangle(point.x, point.y, REPAIR_MARKER_SIZE, REPAIR_MARKER_SIZE, REPAIR_MARKER_BROKEN_COLOR)
        .setStrokeStyle(2, 0x000000, 0.6)
        .setVisible(false);
      this.repairMarkers.set(id, marker);
    }
  }

  /**
   * Build the fog: a viewport-sized darkness with a soft radial hole erased
   * around the player each frame. The hole's edge is a pre-rendered radial
   * gradient — solid clarity through the middle of the vision radius,
   * fading to full darkness AT the radius — so what the eye loses at the
   * fog's edge is exactly what the server stops sending there, and nothing
   * ever visibly pops at a hard circle boundary.
   */
  private createFogOverlay(): void {
    if (!this.textures.exists(FOG_BRUSH_KEY)) {
      const canvas = this.textures.createCanvas(FOG_BRUSH_KEY, FOG_BRUSH_SIZE, FOG_BRUSH_SIZE);
      if (canvas) {
        const ctx = canvas.getContext();
        const half = FOG_BRUSH_SIZE / 2;
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(0.55, "rgba(255,255,255,1)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, FOG_BRUSH_SIZE, FOG_BRUSH_SIZE);
        canvas.refresh();
      }
    }

    // The brush is never on the display list — it exists only to be stamped
    // into the overlay with the erase blend each frame.
    this.fogBrush = this.make.image({ key: FOG_BRUSH_KEY, add: false });
    this.fogOverlay = this.add
      .renderTexture(0, 0, this.scale.width, this.scale.height)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(FOG_DEPTH);
  }

  /**
   * Redraw the fog for this frame: fill, then erase a soft circle at the
   * player's screen position. Radius follows the ground the player stands
   * on (`visionRadiusAt` — the same function the server filters by), eased
   * so stepping through a doorway swells the light rather than snapping it.
   * Death dissolves the fog entirely: the dead see the whole town, and the
   * server really does send them all of it.
   */
  private renderFog(): void {
    const rt = this.fogOverlay;
    const brush = this.fogBrush;
    if (!rt || !brush) {
      return;
    }

    const pos = this.entities.get(this.room.sessionId)?.predicted;
    // The lamplighter's lit lamp dissolves the fog for everyone, the same
    // way being a ghost already does — the server's own visibility bypass
    // (see `lampLit` on `GameState.players`'s filterChildren) is what
    // actually reveals anyone; this only makes the world look the way the
    // data already behaves.
    const targetAlpha = this.localIsGhost || this.room.state.lampLit ? 0 : FOG_MAX_ALPHA;
    this.fogAlpha += (targetAlpha - this.fogAlpha) * FOG_FADE_RATE;

    rt.clear();
    if (!pos || this.fogAlpha < 0.01) {
      return;
    }

    this.fogRadius +=
      (visionRadiusAt(pos, this.room.state.sabotageActive) - this.fogRadius) * FOG_RADIUS_RATE;

    rt.fill(FOG_COLOR, this.fogAlpha);
    const cam = this.cameras.main;
    brush.setScale((this.fogRadius * 2) / FOG_BRUSH_SIZE);
    rt.erase(brush, pos.x - cam.scrollX, pos.y - cam.scrollY);
    this.atmosphere.stampLightBleed(rt, cam.scrollX, cam.scrollY);
  }

  /**
   * Show a "press R" prompt when the local player is near an unreported body,
   * and ask the server to start a meeting on a fresh R press. Same split as
   * every other interaction here: this is only a proximity hint, the server
   * re-checks the reporter's distance to that exact body before anything
   * happens — see `GameRoom.handleReportBody`.
   */
  private updateReportPrompt(): boolean {
    if (this.localIsGhost) {
      this.reportPrompt?.setVisible(false);
      return false;
    }
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos) {
      this.reportPrompt?.setVisible(false);
      return false;
    }

    const nearestBodyId = this.findNearestBody(pos);

    if (!this.reportPrompt) {
      this.reportPrompt = this.add
        .text(0, 0, i18n.t("game.reportPrompt"), {
          ...phaserTextStyle("ui", "caption"),
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1);
    }

    if (nearestBodyId) {
      this.reportPrompt.setPosition(pos.x, pos.y - LABEL_OFFSET_Y - 14);
      this.reportPrompt.setVisible(true);
    } else {
      this.reportPrompt.setVisible(false);
    }

    if (nearestBodyId && (Phaser.Input.Keyboard.JustDown(this.rKey) || this.consumeTouchAction("report"))) {
      this.room.send("report_body", { bodyId: nearestBodyId });
    }

    return Boolean(nearestBodyId);
  }

  /** The nearest body's key (== the dead player's session id) in range, if any. */
  private findNearestBody(pos: Vec2): string | undefined {
    let best: string | undefined;
    let bestDistance = REPORT_BODY_RANGE;

    for (const [key, entity] of this.bodies) {
      const bodyPos = { x: entity.circle.x, y: entity.circle.y };
      const distance = Phaser.Math.Distance.Between(pos.x, pos.y, bodyPos.x, bodyPos.y);
      if (distance <= bestDistance) {
        // A corpse just across a wall is in range but not in sight; the
        // server would refuse the report, so don't offer the prompt.
        if (!canSee(pos, bodyPos)) {
          continue;
        }
        best = key;
        bestDistance = distance;
      }
    }

    return best;
  }

  /**
   * Show a "press B" prompt near the Town Hall and ask the server to ring the
   * bell on a fresh press. Whether it actually rings — uses remaining,
   * sabotage lock — is decided entirely server-side; a rejected ring is
   * silent here, the same as every other rejected interaction in this scene.
   */
  private updateBellPrompt(): boolean {
    if (this.localIsGhost) {
      this.bellPrompt?.setVisible(false);
      return false;
    }
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos) {
      this.bellPrompt?.setVisible(false);
      return false;
    }

    const inRange = Phaser.Math.Distance.Between(pos.x, pos.y, TOWN_HALL.x, TOWN_HALL.y) <= BELL_RANGE;

    if (!this.bellPrompt) {
      this.bellPrompt = this.add
        .text(0, 0, i18n.t("game.bellPrompt"), {
          ...phaserTextStyle("ui", "caption"),
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1);
    }

    if (inRange) {
      this.bellPrompt.setPosition(pos.x, pos.y - LABEL_OFFSET_Y - 14);
      this.bellPrompt.setVisible(true);
    } else {
      this.bellPrompt.setVisible(false);
    }

    if (inRange && (Phaser.Input.Keyboard.JustDown(this.bKey) || this.consumeTouchAction("bell"))) {
      this.room.send("call_meeting");
    }

    return inRange;
  }

  /**
   * The Saboteur's comms sabotage blacks out room signage — the client's
   * closest analog to a minimap, since there isn't a separate one. The task
   * list going dark alongside it is React's job (`GameView` reads the same
   * `commsSabotageActive` flag directly off `room.state`).
   */
  private updateCommsVisibility(): void {
    const dark = this.room.state.commsSabotageActive;
    for (const label of this.roomLabels) {
      label.setVisible(!dark);
    }
  }

  /**
   * Show/color the two repair markers and a "press E" prompt near whichever
   * unfixed one the local player is closest to. Whether a repair actually
   * lands — proximity, whether it's already fixed, whether a critical
   * sabotage is even running — is re-checked entirely server-side; this is
   * only the hint.
   */
  private updateRepairPrompt(): boolean {
    const active = this.room.state.criticalSabotageActive;
    for (const [id, marker] of this.repairMarkers) {
      if (!active) {
        marker.setVisible(false);
        continue;
      }
      const fixed = this.room.state.criticalRepairedPoints.includes(id);
      marker.setVisible(true);
      marker.setFillStyle(fixed ? REPAIR_MARKER_FIXED_COLOR : REPAIR_MARKER_BROKEN_COLOR);
    }

    if (!active || this.localIsGhost) {
      this.repairPrompt?.setVisible(false);
      return false;
    }
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos) {
      this.repairPrompt?.setVisible(false);
      return false;
    }

    let nearestId: CriticalRepairPointId | undefined;
    let nearestDistance = REPAIR_RANGE;
    for (const [id, point] of Object.entries(CRITICAL_REPAIR_POINTS) as Array<
      [CriticalRepairPointId, Vec2]
    >) {
      if (this.room.state.criticalRepairedPoints.includes(id)) {
        continue;
      }
      const distance = Phaser.Math.Distance.Between(pos.x, pos.y, point.x, point.y);
      if (distance <= nearestDistance) {
        nearestId = id;
        nearestDistance = distance;
      }
    }

    if (!this.repairPrompt) {
      this.repairPrompt = this.add
        .text(0, 0, i18n.t("game.repairPrompt"), {
          ...phaserTextStyle("ui", "caption"),
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1);
    }

    if (nearestId) {
      this.repairPrompt.setPosition(pos.x, pos.y - LABEL_OFFSET_Y - 14);
      this.repairPrompt.setVisible(true);
    } else {
      this.repairPrompt.setVisible(false);
    }

    if (nearestId && (Phaser.Input.Keyboard.JustDown(this.eKey) || this.consumeTouchAction("interact"))) {
      this.room.send("repair_critical", { pointId: nearestId });
    }

    return Boolean(nearestId);
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
    const lockedRoomSlugs = this.lockedRoomSlugsSnapshot();
    for (const command of this.pending) {
      pos = applyInputWithLocks(pos, command.dir, SIM_DT, lockedRoomSlugs);
    }
    entity.predicted = pos;
  }

  /** A plain-array snapshot of the currently locked rooms, for `applyInputWithLocks`. */
  private lockedRoomSlugsSnapshot(): string[] {
    const slugs: string[] = [];
    this.room.state.lockedRoomSlugs.forEach((slug) => slugs.push(slug));
    return slugs;
  }

  private createTaskMarkers(tasks: ClientTask[]): void {
    for (const task of tasks) {
      // A reconnect could in principle hand back an already-finished task;
      // skip drawing a marker nobody needs to interact with.
      if (task.completedSteps < task.totalSteps) {
        this.addTaskMarker(task);
      }
    }
  }

  private addTaskMarker(task: ClientTask): void {
    const rect = this.add
      .rectangle(task.x, task.y, TASK_MARKER_SIZE, TASK_MARKER_SIZE, TASK_MARKER_COLOR)
      .setStrokeStyle(2, 0x000000, 0.4);
    const label = this.add
      .text(task.x, task.y - TASK_LABEL_OFFSET_Y, task.room, {
        ...phaserTextStyle("ui", "caption"),
        color: "#ffd166",
      })
      .setOrigin(0.5, 1);

    this.taskMarkers.set(task.id, { task, rect, label });
  }

  /**
   * Applied identically whether the underlying task is real or fake — the
   * client has no way to know which, by design. A finished task's marker is
   * removed exactly like a real completion would be.
   */
  private applyTaskProgress(message: TaskProgressMessage): void {
    const marker = this.taskMarkers.get(message.taskId);
    if (!marker) {
      return;
    }
    marker.task.completedSteps = message.completedSteps;
    if (marker.task.completedSteps >= marker.task.totalSteps) {
      marker.rect.destroy();
      marker.label.destroy();
      this.taskMarkers.delete(message.taskId);
    }
  }

  /**
   * Show a "press E" prompt when the local player is near one of their own
   * tasks, and open its mini-game on a fresh E press. This proximity check is
   * UX only: the mini-game itself doesn't complete the task, it just decides
   * *when* to ask the server to. The server re-checks distance and ownership
   * itself at that point and is the only thing that actually grants the
   * completion — see `GameRoom.handleTaskInteract`.
   */
  private updateTaskInteraction(): boolean {
    const local = this.entities.get(this.room.sessionId);
    const pos = local?.predicted;
    if (!pos) {
      this.interactPrompt?.setVisible(false);
      return false;
    }

    const nearest = this.findNearestTask(pos);

    if (!this.interactPrompt) {
      this.interactPrompt = this.add
        .text(0, 0, i18n.t("game.interactPrompt"), {
          ...phaserTextStyle("ui", "caption"),
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1);
    }

    if (nearest) {
      this.interactPrompt.setPosition(pos.x, pos.y - LABEL_OFFSET_Y - 14);
      this.interactPrompt.setVisible(true);
    } else {
      this.interactPrompt.setVisible(false);
    }

    if (nearest && (Phaser.Input.Keyboard.JustDown(this.eKey) || this.consumeTouchAction("interact"))) {
      this.taskModalOpen = true;
      this.interactPrompt.setVisible(false);
      this.game.events.emit("task:open", nearest.task);
    }

    return Boolean(nearest);
  }

  private findNearestTask(pos: Vec2): TaskMarker | undefined {
    let best: TaskMarker | undefined;
    let bestDistance = TASK_INTERACT_RADIUS;

    for (const marker of this.taskMarkers.values()) {
      const distance = Phaser.Math.Distance.Between(pos.x, pos.y, marker.task.x, marker.task.y);
      if (distance <= bestDistance) {
        best = marker;
        bestDistance = distance;
      }
    }

    return best;
  }

  private removePlayer(key: string): void {
    const entity = this.entities.get(key);
    if (!entity) {
      return;
    }
    for (const dispose of entity.disposers) {
      dispose();
    }
    if (entity.hasFootstepVoice) {
      audioEngine.removeFootstepSource(key);
    }
    // Destroying the container tears down every layer and attached cosmetic
    // with it (and stops its idle tweens — see `Havener.destroy`).
    entity.havener.destroy();
    entity.badge.destroy();
    entity.badgeNumber.destroy();
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
    for (const marker of this.taskMarkers.values()) {
      marker.rect.destroy();
      marker.label.destroy();
    }
    this.taskMarkers.clear();
    for (const key of [...this.bodies.keys()]) {
      this.removeBody(key);
    }
    this.interactPrompt?.destroy();
    this.reportPrompt?.destroy();
    this.bellPrompt?.destroy();
    this.repairPrompt?.destroy();
    for (const marker of this.repairMarkers.values()) {
      marker.destroy();
    }
    this.repairMarkers.clear();
    this.townHallRect?.destroy();
    this.fogOverlay?.destroy();
    this.fogBrush?.destroy();
    this.atmosphere?.destroy();
    this.tilemapLayer?.destroy();
    for (const label of this.roomLabels) {
      label.destroy();
    }
    this.roomLabels.length = 0;
  }

  private parseColor(hex: string): number {
    if (!hex) {
      return FALLBACK_COLOR;
    }
    return Phaser.Display.Color.HexStringToColor(hex).color;
  }
}
