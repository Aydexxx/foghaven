/**
 * The 14 §3.5 player lantern colours — the single source of truth for player
 * identity in Foghaven. "Every player wears the same desaturated oilskin
 * coat. What distinguishes them is the colour of the light they carry" — so
 * this list, not a body palette, is what actually tells players apart.
 *
 * Lives in `shared/` (not just `client/src/theme/tokens.ts`, which
 * re-exports this) because the SERVER is now the one assigning a colour to
 * each player (`GameRoom.pickLanternColor`) — see docs/ART_BIBLE.md §3.5/§6.2
 * and the Phase 7.7 prompt. One array, imported by both sides, is what makes
 * "the server is authoritative for lantern state, the client never
 * predicts or infers it" actually true for the colour half of that, not just
 * the lit/extinguished/dropped half.
 *
 * Order matches the ART_BIBLE §3.5 table exactly and is meaningful — do not
 * resort it alphabetically or otherwise. `MAX_PLAYERS` (gameConfig.ts) is
 * capped at exactly this array's length so every seat gets a unique colour
 * with no wrap, ever.
 */
export const lanternColors = [
  { id: "amber", name: "Amber", hex: "#FFB347" },
  { id: "crimson", name: "Crimson", hex: "#FF6B6B" },
  { id: "rose", name: "Rose", hex: "#FF9FC4" },
  { id: "violet", name: "Violet", hex: "#B98CFF" },
  { id: "cobalt", name: "Cobalt", hex: "#6BA8FF" },
  { id: "cyan", name: "Cyan", hex: "#5FE0DC" },
  { id: "jade", name: "Jade", hex: "#6FE09A" },
  { id: "lime", name: "Lime", hex: "#C8F06A" },
  { id: "bone", name: "Bone", hex: "#F2EAD8" },
  { id: "rust", name: "Rust", hex: "#E07A4A" },
  { id: "ash", name: "Ash", hex: "#9AA5B5" },
  { id: "plum", name: "Plum", hex: "#9B6BAA" },
  { id: "moss", name: "Moss", hex: "#8FA85C" },
  { id: "coral", name: "Coral", hex: "#FFA48F" },
] as const;

export type LanternColor = (typeof lanternColors)[number];
export type LanternColorId = LanternColor["id"];
