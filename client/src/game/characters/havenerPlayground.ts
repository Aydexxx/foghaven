import Phaser from "phaser";
import { Havener, HAVENER_ATLAS_KEY, type Facing, type HavenerState } from "./Havener";
import { HAVENER_ANIM_CONFIG, walkConfigLeaves, type ConfigLeaf } from "./havenerAnimConfig";
import { colors, lanternColors } from "../../theme/tokens";
import { ATLAS_DIR, ATLAS_PAGES } from "../../assets/atlasManifest";

/**
 * The dev-only animation tuning playground for the Havener — how the §4.4
 * tween feel actually gets tuned, per the ART_BIBLE mandate that every
 * duration/amplitude/easing live in one config object. Served at
 * `/havener-playground.html`, same convention as `/preview.html` (a separate
 * Vite HTML entry `vite.config.ts` never registers as a build input, so it
 * never ships to players — only reachable via `npm run dev`).
 *
 * One Havener, six state buttons that mirror exactly how GameScene drives it
 * (`playState`/`playDeath`), and a live slider for every numeric leaf in
 * `HAVENER_ANIM_CONFIG` — generated generically by `walkConfigLeaves`, so a
 * new config field gets a working, sensibly-ranged slider for free. Dragging
 * any slider mutates the config in place and immediately restarts whichever
 * loop is currently playing (`Havener.restartCurrentState`), so the change is
 * visible without re-clicking a button.
 */

function hexNum(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

const VIEWPORT_W = 420;
const VIEWPORT_H = 360;
const ZOOM = 3.2;

class PlaygroundScene extends Phaser.Scene {
  havener!: Havener;
  facing: Facing = "right";
  lanternIndex = 0;

  constructor() {
    super("havener-playground");
  }

  preload(): void {
    const page = ATLAS_PAGES[0];
    const json = page.replace(/\.png$/, ".json");
    this.load.atlas(HAVENER_ATLAS_KEY, `/${ATLAS_DIR}/${page}`, `/${ATLAS_DIR}/${json}`);
  }

  create(): void {
    this.cameras.main.setZoom(ZOOM);
    // The Havener's local origin is its feet; centring a bit above that puts
    // the whole body (which extends upward from the feet) in frame instead
    // of cropping the head against the top edge.
    this.cameras.main.centerOn(0, -46);
    this.drawGroundReference();
    this.spawnHavener();
    buildControls(this);
  }

  /** Destroy and rebuild from scratch — the clean way to recover after death (a detached, un-reattachable lantern) or any other terminal state. */
  spawnHavener(): void {
    this.havener?.destroy();
    this.havener = new Havener(this, 0, 0, lanternColors[this.lanternIndex]!.hex);
    this.havener.setFacing(this.facing);
  }

  cycleLantern(): void {
    this.lanternIndex = (this.lanternIndex + 1) % lanternColors.length;
    this.havener.setLanternColor(lanternColors[this.lanternIndex]!.hex);
  }

  setFacing(dir: Facing): void {
    this.facing = dir;
    this.havener.setFacing(dir);
  }

  /** A ground line + tick marks so the death lantern's toss/bounce/roll distance and the run lean are legible against something, not floating in a void. */
  private drawGroundReference(): void {
    const g = this.add.graphics();
    g.lineStyle(1, hexNum(colors.fogDark), 0.7);
    g.lineBetween(-200, 0, 200, 0);
    for (let x = -180; x <= 180; x += 20) {
      g.lineBetween(x, -4, x, 4);
    }
    g.setDepth(-1);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "playground-canvas",
  width: VIEWPORT_W,
  height: VIEWPORT_H,
  backgroundColor: colors.void,
  scene: [PlaygroundScene],
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

const STATE_BUTTONS: Array<{ label: string; state: HavenerState }> = [
  { label: "Idle", state: "idle" },
  { label: "Walk", state: "walk" },
  { label: "Run", state: "run" },
  { label: "Interact", state: "interact" },
  { label: "Ghost", state: "ghost" },
  { label: "Death (signature moment)", state: "death" },
];

function buildControls(scene: PlaygroundScene): void {
  const root = document.getElementById("controls")!;

  root.appendChild(buildTransportRow(scene));
  root.appendChild(buildStateButtons(scene));
  root.appendChild(buildConfigSliders(scene));
}

function buildTransportRow(scene: PlaygroundScene): HTMLElement {
  const row = el("div", { className: "row" });

  const facingBtn = el("button", { textContent: "Facing: right" });
  facingBtn.addEventListener("click", () => {
    const next: Facing = scene.facing === "right" ? "left" : "right";
    scene.setFacing(next);
    facingBtn.textContent = `Facing: ${next}`;
  });
  row.appendChild(facingBtn);

  const lanternBtn = el("button", { textContent: "Cycle lantern colour" });
  lanternBtn.addEventListener("click", () => scene.cycleLantern());
  row.appendChild(lanternBtn);

  const resetBtn = el("button", { textContent: "Reset (new Havener)", className: "danger" });
  resetBtn.addEventListener("click", () => scene.spawnHavener());
  row.appendChild(resetBtn);

  return row;
}

function buildStateButtons(scene: PlaygroundScene): HTMLElement {
  const wrap = el("div", { className: "row" });
  for (const { label, state } of STATE_BUTTONS) {
    const btn = el("button", { textContent: label });
    btn.addEventListener("click", () => {
      if (state === "death") {
        scene.havener.playDeath(() => scene.havener.playState("ghost"));
      } else {
        scene.havener.playState(state);
      }
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

/** One <fieldset> per top-level config key (idle/walk/.../death.lantern), one labeled range input per numeric leaf inside it — built entirely from `walkConfigLeaves`, so a new config field just shows up here. */
function buildConfigSliders(scene: PlaygroundScene): HTMLElement {
  const container = el("div", { className: "sliders" });
  const leaves = walkConfigLeaves(HAVENER_ANIM_CONFIG);

  const groups = new Map<string, ConfigLeaf[]>();
  for (const leaf of leaves) {
    const group = leaf.path.split(".").slice(0, -1).join(".");
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(leaf);
  }

  for (const [group, groupLeaves] of groups) {
    const fieldset = el("fieldset");
    fieldset.appendChild(el("legend", { textContent: group }));
    for (const leaf of groupLeaves) {
      fieldset.appendChild(buildSliderRow(scene, leaf));
    }
    container.appendChild(fieldset);
  }
  return container;
}

function buildSliderRow(scene: PlaygroundScene, leaf: ConfigLeaf): HTMLElement {
  const fieldLabel = leaf.path.split(".").at(-1)!;
  const row = el("label", { className: "slider-row" });

  const labelText = el("span", { className: "slider-label", textContent: fieldLabel });
  const valueText = el("span", { className: "slider-value", textContent: String(leaf.get()) });

  const input = el("input", {
    type: "range",
    min: String(leaf.range.min),
    max: String(leaf.range.max),
    step: String(leaf.range.step),
    value: String(leaf.get()),
  });
  input.addEventListener("input", () => {
    const value = Number(input.value);
    leaf.set(value);
    valueText.textContent = String(value);
    // Live-tune: if a loop is currently showing, restart it now so the drag
    // is visible immediately instead of on the next button click.
    scene.havener.restartCurrentState();
  });

  row.appendChild(labelText);
  row.appendChild(input);
  row.appendChild(valueText);
  return row;
}
