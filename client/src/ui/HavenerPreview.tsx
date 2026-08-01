import { useEffect, useRef } from "react";
import {
  drawHavenerPreview,
  HAVENER_PREVIEW_SIZE,
  type HavenerPreviewOptions,
} from "../game/characters/havenerPreview";

interface HavenerPreviewProps extends HavenerPreviewOptions {
  /** Display size in CSS pixels — the canvas itself always renders at `HAVENER_PREVIEW_SIZE` for crispness. */
  size?: number;
}

/** A still frame of the player's own Havener, in their lantern colour — see `havenerPreview.ts`'s own doc. */
export function HavenerPreview({ size = 72, ...options }: HavenerPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      drawHavenerPreview(ctx, options);
    }
    // Same reasoning as `RigPreview`: `options` is a fresh object every
    // render, and this draw is cheap enough that redrawing on every render
    // is simpler and no less correct than a hand-rolled dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <canvas
      ref={canvasRef}
      width={HAVENER_PREVIEW_SIZE}
      height={HAVENER_PREVIEW_SIZE}
      className="havener-preview-canvas"
      style={{ width: size, height: size }}
    />
  );
}
