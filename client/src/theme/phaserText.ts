import { fontStacks, fonts, typeScale } from "./tokens";

type Role = keyof typeof fontStacks;
type ScaleKey = keyof typeof typeScale;

/**
 * Builds the fontFamily/fontSize/fontStyle trio for a Phaser Text game
 * object from the exact same §7 tokens the CSS layer's font-family and
 * font-size custom properties read from — canvas text and DOM text cannot
 * end up with a different family or size for the same role/scale pairing,
 * because both ultimately come from theme/tokens.ts.
 *
 * `fontStyle` carries the numeric font-weight (Phaser concatenates it
 * straight into the canvas `font` shorthand, which accepts a weight token
 * there) rather than a real style keyword — only "ui" ships two weights.
 */
export function phaserTextStyle(
  role: Role,
  scale: ScaleKey,
  weight: "regular" | "bold" = "regular",
): { fontFamily: string; fontSize: string; fontStyle: string } {
  let fontWeight: number;
  if (role === "ui") {
    fontWeight = weight === "bold" ? fonts.ui.weightBold : fonts.ui.weightRegular;
  } else if (role === "display") {
    fontWeight = fonts.display.weight;
  } else {
    fontWeight = fonts.numeric.weight;
  }
  return {
    fontFamily: fontStacks[role],
    fontSize: `${typeScale[scale].fontSize}px`,
    fontStyle: String(fontWeight),
  };
}
