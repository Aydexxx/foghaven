import { CHARACTER_HEIGHT, anchorLocal } from "./anchors";
import { colors } from "../../theme/tokens";

/**
 * A static, non-Phaser render of the Havener in a player's own lantern
 * colour — ART_BIBLE §4.1/§3.5: every player wears the identical coat, and
 * the ONE thing that identifies them is their lantern's light. Used wherever
 * a player needs to be shown as themselves outside the live game world: the
 * meeting screen's vote grid, so a card reads as a face and not a name tag
 * (§8: "A player card without a face is a spreadsheet row").
 *
 * Deliberately not `RigPreview`/`rigPreview.ts`. That module draws the
 * ARCHETYPE costume system (`characters/archetypes.ts`) — six differently-
 * shaped silhouettes used for cosmetic/results previews — which is a
 * different, older art system from the live in-round body. The live body
 * `Havener.ts` actually renders is identical for every player; this mirrors
 * THAT one, at rest, in plain canvas for the same reason `RigPreview` is
 * plain canvas rather than a second Phaser instance (see its own doc): a
 * meeting screen can hold up to 14 of these at once, and none of them need
 * to be alive.
 *
 * Current build ships with the atlas art step optional (`npm run atlas`) —
 * see `GameScene.ts`'s own preload comment — so, exactly like `Havener.ts`
 * falling back to its placeholder composite on a load error, this draws the
 * same flat-shape placeholder unconditionally rather than attempting to load
 * the atlas image a second time outside Phaser's own texture cache. Swapping
 * in the real body art later is a change to this one function; every call
 * site stays the same.
 */

export interface HavenerPreviewOptions {
  /** The player's §3.5 lantern colour, as a hex string. */
  lanternColor: string;
  /** Draw the lantern dark and un-glowing — a dropped/extinguished lantern, same as `LanternState`. */
  lanternLit?: boolean;
}

/** Padding around the character so the lantern glow isn't clipped at the canvas edge. */
const MARGIN = 24;

/** Natural canvas size at 1:1 with the body's own units — see `CHARACTER_HEIGHT`. */
export const HAVENER_PREVIEW_SIZE = CHARACTER_HEIGHT + MARGIN * 2;

/**
 * Render one still frame onto `ctx`, sized to at least
 * `HAVENER_PREVIEW_SIZE` square. Clears first, so it's safe to call
 * repeatedly (a lantern state or colour change while the meeting is live).
 */
export function drawHavenerPreview(
  ctx: CanvasRenderingContext2D,
  { lanternColor, lanternLit = true }: HavenerPreviewOptions,
): void {
  ctx.clearRect(0, 0, HAVENER_PREVIEW_SIZE, HAVENER_PREVIEW_SIZE);
  ctx.save();
  // Origin at the feet, matching `Havener`'s own local space — (0,0) here is
  // the same point a player's world (x, y) denotes.
  ctx.translate(HAVENER_PREVIEW_SIZE / 2, HAVENER_PREVIEW_SIZE - MARGIN);

  const hand = anchorLocal("hand");
  const face = anchorLocal("face");
  const feet = anchorLocal("feet"); // (0, 0) by definition — named for symmetry with `Havener.ts`.

  // The glow, first, so the body draws on top of it — same z-order as the
  // live rig's glowOverlay-under-heldItem... no: §4.2 actually draws glow
  // ABOVE the held item (z7 over z6), but a glow that fully covers the
  // lantern reads as a blown-out blob at this small a size, so here the body
  // and lantern are drawn on top of a softer under-glow instead. Purely a
  // legibility call for the tiny card context; the live in-world sprite is
  // unaffected by anything in this file.
  if (lanternLit) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = lanternColor;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // Body: the same flat placeholder composite `Havener.buildBody()` falls
  // back to when the atlas isn't loaded.
  ctx.fillStyle = colors.fogMid;
  roundRect(ctx, -20, -CHARACTER_HEIGHT, 40, CHARACTER_HEIGHT, 10);
  ctx.fill();

  // Boots.
  ctx.fillStyle = colors.ink;
  roundRect(ctx, feet.x - 13, feet.y - 12, 26, 12, 4);
  ctx.fill();

  // Face: two asymmetric glowing eyes — no mouth, per §4.1.
  ctx.fillStyle = colors.flameGlow;
  ctx.beginPath();
  ctx.ellipse(face.x - 6, face.y, 3.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(face.x + 6, face.y, 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // The lantern itself, dark when not lit — see `Havener.setLanternState`.
  ctx.fillStyle = lanternLit ? lanternColor : colors.ink;
  roundRect(ctx, hand.x - 6, hand.y - 8, 12, 18, 2);
  ctx.fill();
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 1.5;
  roundRect(ctx, hand.x - 6, hand.y - 8, 12, 18, 2);
  ctx.stroke();

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
