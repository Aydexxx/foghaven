import { useEffect, useRef } from "react";
import { drawRigPreview, RIG_PREVIEW_SIZE, type RigPreviewOptions } from "../game/characters/rigPreview";

interface RigPreviewProps extends RigPreviewOptions {
  /** Display size in CSS pixels — the canvas itself always renders at `RIG_PREVIEW_SIZE` for crispness. */
  size?: number;
}

/**
 * A still frame of the character rig, costumed with whichever cosmetics are
 * passed in — the equip screen's "what does this actually look like" view,
 * and the results screen's victory-pose display. See `rigPreview.ts`'s own
 * doc for why this is a plain canvas rather than a second Phaser instance.
 */
export function RigPreview({ size = 96, ...options }: RigPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      drawRigPreview(ctx, options);
    }
    // `options` is a fresh object every render by construction (the caller
    // spreads props into it) — redrawing on every render of this tiny,
    // cheap-to-draw component is simpler and no less correct than hand-
    // rolling a dependency list for a five-field options object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <canvas
      ref={canvasRef}
      width={RIG_PREVIEW_SIZE}
      height={RIG_PREVIEW_SIZE}
      className="rig-preview-canvas"
      style={{ width: size, height: size }}
    />
  );
}
