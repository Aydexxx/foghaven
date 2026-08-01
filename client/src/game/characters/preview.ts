import Phaser from "phaser";
import { ARCHETYPES } from "./archetypes";
import { FRAME_SIZE, RIG_ORIGIN } from "./rig";
import { buildCharacterSpriteSheet } from "./spriteSheet";
import { phaserTextStyle } from "../../theme/phaserText";
import { colors } from "../../theme/tokens";

const SCALE = 3;
const ROW_HEIGHT = FRAME_SIZE * SCALE + 40;
const COL_WIDTH = 190;
const ORIGIN_X = RIG_ORIGIN.x / FRAME_SIZE;
const ORIGIN_Y = RIG_ORIGIN.y / FRAME_SIZE;

/**
 * A standalone art-review harness — not part of the game. Boots one Phaser
 * scene that lays out every archetype at 4x scale playing every animation,
 * so the whole cast and its motion can be checked in one screenshot without
 * spinning up a multiplayer room. Served at `/preview.html`, dev-only.
 */
/** Exposed for the headless art-review driver — see `preview-shot.js`. */
declare global {
  interface Window {
    __previewSprites?: Record<string, Phaser.GameObjects.Sprite>;
  }
}

class PreviewScene extends Phaser.Scene {
  constructor() {
    super("preview");
  }

  create(): void {
    const sets = buildCharacterSpriteSheet(this);
    const animKeys = ["idle", "walk", "task", "death", "ghost"] as const;
    window.__previewSprites = {};

    ARCHETYPES.forEach((rig, row) => {
      const set = sets.find((s) => s.archetypeId === rig.id)!;
      // Feet position first, everything else placed relative to it — the
      // earlier version positioned the archetype/anim labels near the top
      // of the row band and the feet-anchored sprite near the bottom,
      // which visually paired each row's label with the sprites *below*
      // it instead of its own.
      const feetY = 90 + row * ROW_HEIGHT;
      const headroomY = feetY - FRAME_SIZE * SCALE + 40;

      this.add
        .text(20, feetY - 40, rig.id, { ...phaserTextStyle("numeric", "label"), color: colors.foam })
        .setOrigin(0, 0.5);

      animKeys.forEach((anim, col) => {
        const x = 160 + col * COL_WIDTH;
        this.add
          .text(x, headroomY, anim, { ...phaserTextStyle("numeric", "caption"), color: colors.mist })
          .setOrigin(0.5, 0.5);
        const sprite = this.add
          .sprite(x, feetY, "characters")
          .setOrigin(ORIGIN_X, ORIGIN_Y)
          .setScale(SCALE);
        sprite.play(set[anim]);
        window.__previewSprites![`${rig.id}_${anim}`] = sprite;
      });
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  width: 160 + 5 * COL_WIDTH,
  height: 60 + ARCHETYPES.length * ROW_HEIGHT,
  backgroundColor: colors.ink,
  scene: [PreviewScene],
});
