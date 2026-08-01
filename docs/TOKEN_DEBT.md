# Token Debt

Worklist for the visual repaint in Phase 7.13. Generated while building the
design-token system (`client/src/theme/tokens.ts` / `tokens.css`, docs/ART_BIBLE.md
§3 and §7). **Status: the colour repaint (§1) and typography sweep (§2) are
done — see §6.** §3–§5 (spacing/radius/duration near-misses) were already
triaged as needing a human design decision rather than a mechanical snap, and
remain open; their line numbers predate the §1/§2 work in this pass and will
have drifted.

## Why this file exists

The app's UI palette (`client/src/index.css`'s root custom properties — `--ink`,
`--paper-void`, `--brass`, `--danger`, etc.) was a warm brass/parchment theme
that didn't correspond to any colour in the art bible's §3 palette (a cold
fog/lantern theme). Neither did `colorBlindPalette.ts` (Okabe-Ito set),
`characters/palette.ts` (its own slate/parchment set), or any hardcoded colour
in `GameScene.ts`, the minigames, or the atmosphere code.

This pass made the actual mapping decisions (documented per-file below) and
retired every hex literal outside `theme/`. An ESLint rule
(`no-restricted-syntax`, `client/eslint.config.js`) enforces this as an
**error** — see §6.

---

## 1. Colours — done

Every UI-chrome/world colour listed in the original version of this section
was mapped onto an ART_BIBLE §3 token and moved into `client/src/theme/tokens.ts`
/ `tokens.css`. `client/src/index.css` no longer references any of the old
`--ink`/`--paper-*`/`--timber`/`--brass`/`--danger`/`--success` names — those
were transitional aliases onto §3 tokens, and once nothing referenced them the
whole alias block was deleted; every selector in the file now names a
`--color-*` token directly.

**Palettes that answer a different question than "what does the world look
like"** were deliberately *not* remapped onto §3 — doing so would have thrown
away real information (colour-blind-safe distinguishability, maximally
distinct minigame tile IDs). Instead they became their own dedicated token
files under `theme/`, exempt from the hex-literal rule the same way `tokens.ts`
is:

- `client/src/theme/colorBlindPalette.ts` — the Okabe-Ito set, moved verbatim out of `graphics/colorBlindPalette.ts` (which still owns `playerColorIndex`/`displayColorFor`, the actual application logic).
- `client/src/theme/minigameTileColors.ts` — the four-tile identification palette shared by `PatternMemoryGame.tsx` and `WireConnectingGame.tsx`, previously declared twice as identical literal arrays; now one export, imported by both (fixes the dedup note from the original version of this file too).
- `client/src/game/characters/palette.ts` — kept as its own module (not moved into `theme/`, since it's Phaser-domain costume-art colour, not a UI token) but its seven swatches now read from `theme/tokens.ts` via a shared `hexNum()` helper (`theme/phaserColor.ts`) instead of hardcoded hex. Mapping: `slateDark→fogDark`, `slateMid→fogMid`, `slateLight→mist`, `lantern→flameGlow`, `parchment→ropeTan`, `skin→woodLight`, `ink→ink`.

**World/game-canvas colours**, mapped onto §3 by nearest perceptual match plus
semantic fit (`GameScene.ts`, `PhaseAtmosphere.ts`, `lightSources.ts`,
`cosmeticVisuals.ts`, `rigPreview.ts`, `preview.ts`, `GameCanvas.tsx`):

| Constant | Was | Now |
|---|---|---|
| `FALLBACK_COLOR` | `0xffffff` | `colors.foam` |
| `TASK_MARKER_COLOR` | `0xffd166` | `colors.flameGlow` |
| `TOWN_HALL_MARKER_COLOR` | `0x8899ff` | `colors.voteGold` (matches the room's own §5.2 palette assignment) |
| `REPAIR_MARKER_BROKEN_COLOR` | `0xdb4b3c` | `colors.strangerRed` |
| `REPAIR_MARKER_FIXED_COLOR` | `0x4bb35c` | `colors.townGreen` |
| `TILE_COLOR_WALL` | `0x14141c` | `colors.ink` |
| `TILE_COLOR_STREET` | `0x4a4a5c` | `colors.stoneMid` |
| `TILE_COLOR_ROOM` | `0x5c4a38` | `colors.woodMid` |
| `ROOM_LABEL_COLOR` | `"#8f8fae"` | `colors.mist` |
| `FOG_COLOR` | `0x05070d` | `colors.ink` (was near-pure-black, which §2 rule 2 forbids even for a wash) |
| badge/corpse/marker outline strokes | `0x000000` (×6) | `colors.ink` |
| badge-number glyph, corpse "✕" | `"#000000"` | `colors.ink` |
| player name label | `"#ffffff"` | `colors.foam` |
| report/bell/repair/interact prompt text+bg | `"#ffffff"` / `"#000000aa"` (×4, copy-pasted) | one shared `PROMPT_TEXT_STYLE` constant — `colors.foam` on `` `${colors.ink}aa` `` — fixing the dedup note from the original version of this file |
| `TASK_GRADE_COLOR` (`PhaseAtmosphere.ts`) | `0x1c3a5c` | `colors.fogDark` |
| `SABOTAGE_GRADE_COLOR` | `0x6e0f14` | `colors.bloodDeep` |
| fog-wisp particle tint | `0x9db4c9` | `colors.mist` |
| `WARM_LAMP` / `WARM_WINDOW` / `BEAM_WHITE` (`lightSources.ts`) | `0xffb15c` / `0xffc98a` / `0xfff3d6` | `flameDeep` / `flameGlow` / `flameCore`, assigned by relative brightness (beam brightest, lamp dimmest) |
| puddle/rain gradient stops (`PhaseAtmosphere.ts`) | `rgba(10,14,20,…)` / `rgba(220,230,240,…)` / `rgba(210,220,235,…)` | `hexToRgbTriplet(colors.ink)` / `hexToRgbTriplet(colors.foam)` (×2) — the gradient-builder functions now take a token-derived triplet, per the original note that this needed parameterizing, not a find/replace |
| glow-texture gradient stops | `rgba(255,255,255,…)` | **unchanged, intentionally** — this texture is multiplicatively tinted per-instance by the light-source colour above, so only a pure-white base reproduces the tint correctly; see the comment at its call site |
| `COSMETIC_ACCENTS.gold` / `.silver` / `.scarlet` | `0xd4af37` / `0xc4c4cc` / `0xa8402c` | `voteGold` / `foam` / `strangerRed` (scarlet was already an exact match for the old `--danger`) |
| `rigPreview.ts` stroke fallback | `0x14181f` | `PALETTE.ink` (was already a duplicate of it) |
| `preview.ts` (dev-only) labels + bg | `"#fff"` / `"#aaa"` / `"#1d1d26"` | `colors.foam` / `colors.mist` / `colors.ink` |
| `GameCanvas.tsx` Phaser `backgroundColor` | `"#16120c"` | `colors.ink` |

---

## 2. Typography debt — done

Scale: `display-xl`=44 · `display-lg`=32 · `title`=24 · `body`=18 · `label`=15 ·
`caption`=13 (px). Every `font-size` declaration in `client/src/index.css` now
reads a `var(--font-size-*)` token (previously 91 of 94 sat 0.2–2px off the
nearest step, listed line-by-line below in an earlier version of this file —
each was snapped to its nearest step, since none of the deltas were large
enough to represent a deliberate distinct size). Same for `GameScene.ts` and
`characters/preview.ts`'s Phaser text — all route through `phaserTextStyle()`
now.

**One deliberate, documented exception below the 13px floor:** the player
badge's number glyph (`GameScene.ts`, `fontSize: "9px"`) — a reinforcing
identity cue packed inside an 8px-radius badge, not text a player reads for
information (the badge's colour and the nameplate above it carry the actual
information); bumping it to 13px would blow out the badge geometry. See the
comment at that call site.

<details>
<summary>Original per-line breakdown (historical — kept for the record, not an action item)</summary>

### 2a. `client/src/index.css` — `font-size` (91 of 94 declarations; 3 exact
matches were tokenized: `.room-code-value` L156, `.code-digit` L810,
`.code-entry-slot` L830)

The overwhelming majority sit 0.2–2px off the nearest scale step — this looks
like the scale was drawn up independent of what the file actually uses, so this
needs a real remap decision (snap up, snap down, or add intermediate steps),
not a blind substitution. Full list, `line: selector — rem (px) → nearest token,
delta`:

- 124 `.panel h1` — 1.75rem (28px) → equidistant title(24)/display-lg(32), Δ4 each
- 131 `.hint` — 0.9rem (14.4px) → label(15), Δ0.6
- 183 `.host-tag` — 0.75rem (12px) → caption(13), Δ1
- 200 `.role-settings h2` — 0.8rem (12.8px) → caption(13), Δ0.2
- 215 `.preset-button` — 0.85rem (13.6px) → caption(13), Δ0.6
- 228 `.preset-custom-tag` — 0.7rem (11.2px) → caption(13), Δ1.8
- 252 `.role-toggle-row` — 0.9rem (14.4px) → label(15), Δ0.6
- 267 `.faction-tag` — 0.7rem (11.2px) → caption(13), Δ1.8
- 292 `.balance-settings h2` — 0.8rem (12.8px) → caption(13), Δ0.2
- 312 `.setting-row` — 0.9rem (14.4px) → label(15), Δ0.6
- 340 `.field` — 0.85rem (13.6px) → caption(13), Δ0.6
- 350 `.field input` — 1rem (16px) → label(15), Δ1
- 368 `button` — 1rem (16px) → label(15), Δ1
- 401 `.error` — 0.85rem (13.6px) → caption(13), Δ0.6
- 414 `.auth-tab` — 0.85rem (13.6px) → caption(13), Δ0.6
- 429 `.field-hint` — 0.75rem (12px) → caption(13), Δ1
- 435 `.guest-tag` — 0.7rem (11.2px) → caption(13), Δ1.8
- 445 `.link-button` — 0.8rem (12.8px) → caption(13), Δ0.2
- 459 `.reveal-intro` — 0.9rem (14.4px) → label(15), Δ0.6
- 468 `.reveal-role` — 2.5rem (40px) → display-xl(44), Δ4
- 532 `.task-bar-label` — 0.85rem (13.6px) → caption(13), Δ0.6
- 553 `.task-bar-count` — 0.85rem (13.6px) → caption(13), Δ0.6
- 590 `.task-list h2` — 0.8rem (12.8px) → caption(13), Δ0.2
- 609 `.task-list li` — 0.85rem (13.6px) → caption(13), Δ0.6
- 626 `.task-list-offline` — 0.85rem (13.6px) → caption(13), Δ0.6
- 644 `.critical-sabotage-heading` — 1rem (16px) → label(15), Δ1
- 652 `.critical-sabotage-timer` — 1.8rem (28.8px) → display-lg(32), Δ3.2
- 664 `.critical-sabotage-points` — 0.85rem (13.6px) → caption(13), Δ0.6
- 692 `.task-progress` — 0.75rem (12px) → caption(13), Δ1
- 721 `.minigame-panel-header` — 0.95rem (15.2px) → label(15), Δ0.2
- 728 `.minigame-panel-close` — 0.85rem (13.6px) → caption(13), Δ0.6
- 740 `.minigame-instructions` — 0.85rem (13.6px) → caption(13), Δ0.6
- 856 `.keypad-key` — 1.1rem (17.6px) → body(18), Δ0.4
- 943 `.ordering-item` — 1.1rem (17.6px) → body(18), Δ0.4
- 1007 `.hud-ghost` — 0.8rem (12.8px) → caption(13), Δ0.2
- 1025 `.kill-button` — 1rem (16px) → label(15), Δ1
- 1115 `.touch-action-button` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1144 `.ability-hint-toast` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1166 `.onboarding-hint-toast` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1244 `.meeting-stage-label` — 0.8rem (12.8px) → caption(13), Δ0.2
- 1253 `.meeting-timer` — 2.5rem (40px) → display-xl(44), Δ4
- 1261 `.ejection-line` — 1.05rem (16.8px) → body(18), Δ1.2
- 1398 `.vote-option` — 0.95rem (15.2px) → label(15), Δ0.2
- 1415 `.vote-marker` — 0.7rem (11.2px) → caption(13), Δ1.8
- 1439 `.tally-list li` — 0.9rem (14.4px) → label(15), Δ0.6
- 1455 `.tally-voters` — 0.75rem (12px) → caption(13), Δ1
- 1472 `.chat-panel h2` — 0.8rem (12.8px) → caption(13), Δ0.2
- 1494 `.chat-line` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1525 `.chat-composer input` — 0.9rem (14.4px) → label(15), Δ0.6
- 1535 `.chat-composer button` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1558 `.role-tag` — 0.75rem (12px) → caption(13), Δ1
- 1602 `.away-tag` — 0.75rem (12px) → caption(13), Δ1
- 1624 `.audio-settings-toggle` — 1.1rem (17.6px) → body(18), Δ0.4
- 1640 `.graphics-settings-toggle` — 1.1rem (17.6px) → body(18), Δ0.4
- 1656 `.keybinding-settings-toggle` — 1.1rem (17.6px) → body(18), Δ0.4
- 1673 `.language-switcher` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1711 `.audio-settings-label` — 0.9rem (14.4px) → label(15), Δ0.6
- 1721 `.audio-mute-button` — 0.8rem (12.8px) → caption(13), Δ0.2
- 1796 `.friends-tab` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1832 `.friends-list li` — 0.9rem (14.4px) → label(15), Δ0.6
- 1894 `.moderation-button` — 0.85rem (13.6px) → caption(13), Δ0.6
- 1922 `.moderation-notice` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2000 `.report-panel textarea` — 0.9rem (14.4px) → label(15), Δ0.6
- 2026 `.admin-role-tag` — 0.7rem (11.2px) → caption(13), Δ1.8
- 2040 `.admin-observability` — 0.8rem (12.8px) → caption(13), Δ0.2
- 2056 `.admin-tab` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2070 `.admin-filter` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2089 `.admin-report, .admin-user-row` — 0.9rem (14.4px) → label(15), Δ0.6
- 2118 `.admin-reason, .admin-status, .admin-banned-tag` — 0.7rem (11.2px) → caption(13), Δ1.8
- 2174 `.admin-chat-line` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2229 `.admin-ban-history li` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2243 `.admin-toggle` — 1.1rem (17.6px) → body(18), Δ0.4
- 2328 `.inventory-tab` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2365 `.inventory-item-name` — 0.78rem (12.48px) → caption(13), Δ0.52
- 2370 `.inventory-equipped-tag` — 0.65rem (10.4px) → caption(13), Δ2.6
- 2379 `.inventory-item button` — 0.8rem (12.8px) → caption(13), Δ0.2
- 2401 `.checkbox-field` — 0.8rem (12.8px) → caption(13), Δ0.2
- 2489 `.profile-stat-value` — 1.3rem (20.8px) → body(18), Δ2.8
- 2495 `.profile-stat-label` — 0.7rem (11.2px) → caption(13), Δ1.8
- 2504 `.profile-section h3` — 1rem (16px) → label(15), Δ1
- 2524 `.profile-role-row` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2545 `.profile-badge` — 0.75rem (12px) → caption(13), Δ1
- 2582 `.profile-danger-zone h3` — 1rem (16px) → label(15), Δ1
- 2639 `.legal-updated` — 0.75rem (12px) → caption(13), Δ1
- 2645 `.legal-body` — 0.85rem (13.6px) → caption(13), Δ0.6
- 2676 `.cookie-notice p` — 0.8rem (12.8px) → caption(13), Δ0.2
- 2692 `.game-summary-heading` — 1rem (16px) → label(15), Δ1
- 2713 `.game-summary-player-row` — 0.8rem (12.8px) → caption(13), Δ0.2
- 2744 `.game-summary-vote-round-label` — 0.75rem (12px) → caption(13), Δ1
- 2755 `.game-summary-vote-results, .game-summary-vote-ballots` — 0.78rem (12.48px) → caption(13), Δ0.52
- 2788 `.voice-hud` — 0.82rem (13.12px) → caption(13), Δ0.12
- 2814 `.voice-error` — 0.78rem (12.48px) → caption(13), Δ0.52
- 2829 `.voice-mode` — 0.72rem (11.52px) → caption(13), Δ1.48
- 2841 `.voice-silenced` — 0.76rem (12.16px) → caption(13), Δ0.84
- 2880 `.voice-mic-toggle, .voice-peer-mute, .voice-leave` — 0.76rem (12.16px) → caption(13), Δ0.84
- 2893 `.voice-ptt` — 0.78rem (12.48px) → caption(13), Δ0.52
- 2905 `.voice-peers-heading` — 0.72rem (11.52px) → caption(13), Δ1.48
- 2913 `.voice-peers-empty` — 0.76rem (12.16px) → caption(13), Δ0.84
- 2988 `.rotate-device-overlay` (portrait media query) — 1.1rem (17.6px) → body(18), Δ0.4
- 3006 `.fullscreen-toggle` — 1.1rem (17.6px) → body(18), Δ0.4

**`line-height`:** none of the file's 9 explicit `line-height` declarations
(lines 1255, 1625, 1641, 1657, 1895, 2244, 2403, 2646, 3007) match their nearest
typography token's line-height. Six of the nine are `line-height: 1` on
icon-only circular buttons purely to kill extra vertical whitespace — arguably
not "typography" at all, and maybe shouldn't be forced into the scale even in
7.13.

### 2b. `client/src/game/GameScene.ts` — remaining non-exact `fontSize`

(13px occurrences were tokenized onto `typeScale.caption.fontSize` in this pass.)

| Line | Raw | Context | Nearest |
|---|---|---|---|
| 940 | `"9px"` | player badge number glyph | caption(13), Δ4 |
| 949 | `"14px"` | player name label | tie: caption(13) Δ1 / label(15) Δ1 |
| 1184 | `"16px"` | corpse "✕" glyph | label(15), Δ1 |
| 1768 | `"11px"` | task marker room-label | caption(13), Δ2 |

### 2c. `client/src/game/characters/preview.ts` (dev-only)

| Line | Raw | Context | Nearest |
|---|---|---|---|
| 46 | `"16px"` | archetype-id label | label(15), Δ1 |
| 52 | `"12px"` | animation-name label | caption(13), Δ1 |

</details>

---

## 3. Spacing debt (`gap`, `padding*`, `margin*`, `top/right/bottom/left`,
`width/height/min-width/min-height`)

Scale: xs=4 · sm=8 · md=12 · lg=16 · xl=24 · xxl=32 · xxxl=48 (px). 187 exact
matches were tokenized across `index.css` in this pass (see `git log` on that
file for the mechanical commit). Everything below did **not** match exactly and
was left as a literal — this section (near-miss *values*) is still open; the
near-misses genuinely need a human remap-vs-new-step decision, not a
mechanical snap, per the note on each one below.

**Separately, the 48px minimum interactive-height requirement (ART_BIBLE §8's
Button spec, applied site-wide) is done** — independent of whether a given
element's padding/gap happens to land on the spacing scale. Every `<button>`,
`<select>`, and draggable list item now clears 48px, via `<Button>`'s own
`min-height` or an explicit one added where a bespoke element needed it (e.g.
`.ordering-item` in the ordering minigame). One exception remains, tracked
rather than silently ignored: `.wire-plug`/`.wire-socket` in the wire-connecting
minigame are 36px, because the puzzle board is only 300×200 — reaching 48px
means growing the board itself, a minigame-geometry call for a human (see the
comment at that rule and §3c below).

### 3a. `client/src/index.css`

*(rem shown as px for scanability; "Δ" is distance in px from the nearest
step)*

**Near-misses (within ~2px of a step — most likely intentional design values
that should either become new intermediate tokens, or get nudged onto the
scale as a deliberate 7.13 decision):**

- 194 `.role-settings` gap 9.6 → sm(8), Δ1.6
- 209 → already exact, skip
- 240 `.role-toggle-list` gap 5.6 → xs(4), Δ1.6
- 286 `.balance-settings` gap 9.6 → sm(8), Δ1.6
- 304 `.setting-list` gap 5.6 → xs(4), Δ1.6
- 318 `.setting-row label` gap 9.6 → sm(8), Δ1.6
- 339 `.field` gap 5.6 → xs(4), Δ1.6
- 602 `.task-list ul` gap 5.6 → xs(4), Δ1.6
- 959 `.rotation-dials` gap 20 → equidistant lg(16)/xl(24), Δ4 each
- 1102 `.touch-action-buttons` gap 10 → equidistant sm(8)/md(12), Δ2 each
- 1300 `.constable-target-list` gap 6.4 → sm(8), Δ1.6
- 1338 `.assassin-target-list` gap 6.4 → sm(8), Δ1.6
- 1428 `.tally-list` gap 6.4 → sm(8), Δ1.6
- 1488 `.chat-log` gap 5.6 → xs(4), Δ1.6
- 1691 `.audio-settings-panel` gap 14.4 → lg(16), Δ1.6
- 1758 `.friends-panel` gap 14.4 → lg(16), Δ1.6
- 1785 `.friends-tabs` gap 6.4 → sm(8), Δ1.6
- 1821 `.friends-list` gap 6.4 → sm(8), Δ1.6
- 1906 `.roster-moderation` gap 2.4 → xs(4), Δ1.6
- 1946 `.report-panel, .admin-panel` gap 14.4 → lg(16), Δ1.6
- 1975 `.report-reasons` gap 4.8 → xs(4), Δ0.8
- 2038 `.admin-observability` gap 9.6 → sm(8), Δ1.6
- 2045 `.admin-tabs` gap 6.4 → sm(8), Δ1.6
- 2069 `.admin-filter` gap 6.4 → sm(8), Δ1.6
- 2194 `.admin-user-detail` gap 9.6 → sm(8), Δ1.6
- 2271 `.inventory-panel` gap 14.4 → lg(16), Δ1.6
- 2307 `.inventory-preview` gap 4.8 → xs(4), Δ0.8
- 2317 `.inventory-tabs` gap 6.4 → sm(8), Δ1.6
- 2344 `.inventory-grid` gap 9.6 → sm(8), Δ1.6
- 2351 `.inventory-item` gap 5.6 → xs(4), Δ1.6
- 2456 `.profile-preview` gap 4.8 → xs(4), Δ0.8
- 2472 `.profile-stats-grid` gap 9.6 → sm(8), Δ1.6
- 2479 `.profile-stat` gap 3.2 → xs(4), Δ0.8
- 2514 `.profile-role-list` gap 4.8 → xs(4), Δ0.8
- 2588 `.profile-delete-form` gap 9.6 → sm(8), Δ1.6
- 2702 `.game-summary-players` gap 4.8 → xs(4), Δ0.8
- 2732 `.game-summary-votes` gap 9.6 → sm(8), Δ1.6
- 2759 `.game-summary-vote-results, .game-summary-vote-ballots` gap 2.4 → xs(4), Δ1.6
- 2892 `.voice-ptt` gap 6.4 → sm(8), Δ1.6
- (padding) 214 `.preset-button` 6.4/**sm** → first value only, Δ1.6
- 248 `.role-toggle-row` padding 6.4/9.6 → sm(8) both, Δ1.6 each
- 271 `.faction-tag` padding 1.6/7.2 → xs(4) Δ2.4 / sm(8) Δ0.8
- 308 `.setting-row` padding 6.4/9.6 → sm(8) both, Δ1.6 each
- 345 `.field input` padding 9.6/**md** → first value only, Δ1.6
- 361 `button` padding 11.2/**lg** → first value only, Δ0.8
- 413 `.auth-tab` padding 6.4/**sm** → first value only, Δ1.6
- 579, 621 `.task-list`, `.task-list-offline` padding **md**/13.6 → second value, Δ1.6
- 634 `.critical-sabotage-banner` padding 9.6/**lg** → first value only, Δ1.6
- 712 `.minigame-panel` padding 20 → equidistant lg(16)/xl(24), Δ4 each
- 727 `.minigame-panel-close` padding **xs**/8.8 → second value, Δ0.8
- 941 `.ordering-item` padding 9.6 → sm(8), Δ1.6
- 1002 `.hud-ghost` padding 3.2/9.6 → xs(4) Δ0.8 / sm(8) Δ1.6
- 1109 `.touch-action-button` padding 6.4/14.4 → sm(8) Δ1.6 / lg(16) Δ1.6
- 1138, 1160 `.ability-hint-toast`, `.onboarding-hint-toast` padding 9.6/**lg** → first value, Δ1.6
- 1360 `.assassin-role-select` padding **xs**/6.4 → second value, Δ1.6
- 1394 `.vote-option` padding 9.6/**md** → first value, Δ1.6
- 1436 `.tally-list li` padding 6.4/**md** → first value, Δ1.6
- 1519 `.chat-composer input` padding **sm**/9.6 → second value, Δ1.6
- 1534 `.chat-composer button` padding **sm**/12.8 → second value, Δ0.8
- 1667 `.language-switcher` padding 6.4/9.6 → sm(8) Δ1.6 each
- 1692, 1759, 1947, 2272, 2427, 2612 (`.audio-settings-panel`, `.friends-panel`,
  `.report-panel/.admin-panel`, `.inventory-panel`, `.profile-panel`,
  `.legal-panel`) padding **xl**/28 → second value → equidistant xl(24)/xxl(32), Δ4 each
- 1716 `.audio-mute-button` padding 4.8/9.6 → xs(4) Δ0.8 / sm(8) Δ1.6
- 1787, 2047, 2319 (`.friends-tabs`, `.admin-tabs`, `.inventory-tabs`)
  padding-bottom 9.6 → sm(8), Δ1.6
- 1791, 2051, 2323 (`.friends-tab`, `.admin-tab`, `.inventory-tab`) padding
  6.4/11.2 → sm(8) Δ1.6 / md(12) Δ0.8
- 1828 `.friends-list li` padding **sm**/9.6 → second value, Δ1.6
- 1865 `.friend-invite-toast` padding **lg**/20 → second value → equidistant lg(16)/xl(24), Δ4 each
- 1889 `.moderation-button` padding 1.6/5.6 → xs(4) Δ2.4/Δ1.6
- 1982 `.report-reasons label` padding 6.4/**sm** → first value, Δ1.6
- 2029, 2121 (`.admin-role-tag`, `.admin-reason/.admin-status/.admin-banned-tag`)
  padding 2.4/6.4 → xs(4) Δ1.6 / sm(8) Δ1.6
- 2085 `.admin-report, .admin-user-row` padding 9.6/11.2 → sm(8) Δ1.6 / md(12) Δ0.8
- 2164 `.admin-evidence` padding **sm**/9.6 → second value, Δ1.6
- 2209 `.admin-ban-form, .admin-ban-state` padding 11.2 → md(12), Δ0.8
- 2225 `.admin-ban-history li` padding 6.4/9.6 → sm(8) Δ1.6 each
- 2352 `.inventory-item` padding 9.6 → sm(8), Δ1.6
- 2378 `.inventory-item button` padding 6.4/**sm** → first value, Δ1.6
- 2480 `.profile-stat` padding 9.6 → sm(8), Δ1.6
- 2520 `.profile-role-row` padding 6.4/9.6 → sm(8) Δ1.6 each
- 2661 `.cookie-notice` padding 14.4/17.6 → lg(16) Δ1.6 each
- 2709 `.game-summary-player-row` padding 5.6/9.6 → xs(4) Δ1.6 / sm(8) Δ1.6
- 2736 `.game-summary-vote-round` padding **sm**/9.6 → second value, Δ1.6
- 2764 `.game-summary-vote-ballots` padding-top 4.8 → xs(4), Δ0.8
- 2781 `.voice-hud` padding 9.6/11.2 → sm(8) Δ1.6 / md(12) Δ0.8
- 2798 `.voice-join` padding **sm**/12.8 → second value, Δ0.8
- 2837 `.voice-silenced` padding 5.6/**sm** → first value, Δ1.6
- 2875 `.voice-mic-toggle, .voice-peer-mute, .voice-leave` padding 4.8/8.8 → xs(4) Δ0.8 / sm(8) Δ0.8
- 2900 `.voice-peers` padding-top 6.4 → sm(8), Δ1.6
- (margin) 651 `.critical-sabotage-timer` 3.2 → xs(4), Δ0.8
- 1277 `.camera-reveal .roster` margin-top 5.6 → xs(4), Δ1.6
- 1502 `.chat-sender` margin-right 6.4 → sm(8), Δ1.6
- 1592 `.reconnect-title` 6.4 → sm(8), Δ1.6
- 2142 `.admin-report-note` 4.8 → xs(4), Δ0.8
- 2407 `.checkbox-field input` margin-top 3.2 → xs(4), Δ0.8
- 2743, 2763, 2904 (`.game-summary-vote-round-label`, `.game-summary-vote-ballots`,
  `.voice-peers-heading`) 4.8 → xs(4), Δ0.8
- 2812 `.voice-error` 6.4 → sm(8), Δ1.6
- (position) 1914 `.moderation-notice` bottom 72 → far outside scale
- 2234 `.admin-toggle` left 72 → far outside scale
- 1099 `.touch-action-buttons` bottom 124 → far outside scale (derived: 92+16+16)
- 2775 `.voice-hud` bottom 64 → xxxl(48), Δ16
- (width/height) 75/76 `.loading-spinner` 40 → equidistant xxl(32)/xxxl(48), Δ8 each
- 538 `.task-bar-track` height 10 → equidistant sm(8)/md(12), Δ2 each
- 555 `.task-bar-count` min-width 72 → far outside scale
- 763/764 `.wire-plug, .wire-socket` 36 → xxl(32), Δ4 (intentionally short of the 44px touch target, per comment)
- 804/805, 824/825 `.code-digit`, `.code-entry-slot` 35.2/41.6 → xxl(32)/xxxl(48)
- 853/854 `.keypad-key` 51.2 → xxxl(48), Δ3.2
- 865/866 `.calibration-track` 280×20 → far outside scale (component dims)
- 889/890 `.calibration-indicator` 6×28 → equidistant both directions
- 901 `.calibration-stop` 140 → far outside scale
- 912/913 `.pattern-tile` 70×70 → far outside scale
- 937 `.ordering-list` 220 → far outside scale
- 964/965 `.rotation-dial` 72 → xxxl(48), Δ24
- 986/987 `.rotation-target` 30×3 → xxl(32) Δ2 / xs(4) Δ1
- 993 `.rotation-needle` width 30 → xxl(32), Δ2
- 1016/1017 `.kill-button` 92 → far outside scale
- 1071/1072 `.touch-joystick-base` 110 → far outside scale
- 1107/1108 `.touch-action-button` min-width/min-height 64/44 → xxxl(48) Δ16/Δ4 (44 is the standard touch-target minimum, not a spacing value)
- 1484 `.chat-log` height 260 → far outside scale
- 1618/1619, 1634/1635, 1650/1651, 2237/2238, 3000/3001 (the five `*-toggle`
  circular buttons) 44×44 → xxxl(48), Δ4
- 1694 `.audio-settings-panel` min-width 320 → large layout dimension, out of scope
- 1845/1846 `.friend-status` 8.8 → sm(8), Δ0.8
- 2675 `.cookie-notice p` min-width 220 → far outside scale
- 2852 `.voice-meter` height 9.6 → sm(8), Δ1.6

**Uncertain category — needs human judgment, not a spacing question at all:**
- 988, 995 `.rotation-target`/`.rotation-needle` `margin-top: -1.5px/-2px` — optical-centering half-offsets, magnitude coincidentally close to a token but semantically not spacing
- 1086 `.touch-joystick-knob` `margin: -24px 0 0 -24px` — centering offset, magnitude exactly matches xxl(24) but negative
- 888 `.calibration-indicator` `top: -4px` — same pattern, magnitude exactly matches xs(4)
- 674 `.task-check` `width: 1em` — font-relative, not a fixed length

**Border-width** (not in scope — no border-width scale exists yet): the file is
already internally consistent on a 1px/2px/3px system (borders on nearly every
panel/card/input use 1px; 2px and 3px are used consistently for a handful of
thicker elements). If 7.13 wants a `--border-width-*` scale, this part of the
file needs no remediation first, just tokenizing the three existing steps.

### 3b. `client/src/ui/RigPreview.tsx` and its callers

One semantic value ("RigPreview display size in px") expressed as five
unrelated magic numbers — a strong candidate for its own small size scale
independent of whether it also ends up snapped to the spacing scale:

| File | Line | Raw | Context | Nearest |
|---|---|---|---|---|
| `RigPreview.tsx` | 15 | `96` (default `size` prop) | default preview canvas size | xxxl(48)×2, not really a spacing-scale candidate |
| `GameOverScreen.tsx` | 129 | `40` | victory-list thumbnail size | tie: xxl(32) Δ8 / xxxl(48) Δ8 |
| `InventoryPanel.tsx` | 137 | `128` | main equip-screen preview size | xxxl(48), Δ80 |
| `InventoryPanel.tsx` | 165 | `72` | per-item grid thumbnail size | xxxl(48), Δ24 |
| `ProfilePanel.tsx` | 147 | `112` | profile-screen preview size | xxxl(48), Δ64 |

### 3c. `client/src/game/minigames/WireConnectingGame.tsx`

Board geometry for an absolutely-positioned mini-game, not conventional
spacing — flagged for human judgment on whether it belongs in this scale at all:

| Line | Raw | Context |
|---|---|---|
| 6 | `300` (`BOARD_WIDTH`) | inline `width` |
| 7 | `200` (`BOARD_HEIGHT`) | inline `height` |
| 8 | `30` (`PLUG_X`) | plug x-position |
| 9 | `BOARD_WIDTH - 30` (`SOCKET_X`) | socket x-position |
| 12 | `30`, `60` (`slotY` math) | vertical slot spacing |

---

## 4. Radius debt

Scale: sm=6 · md=10 · lg=12 · xl=14 · xxl=20 (px). 27 exact `6px → sm` matches
were tokenized in this pass.

**The single biggest open question:** `4px` border-radius is used **28 times**
in `index.css` (lines 150, 179, 251, 311, 347, 363, 814, 834, 892 [3px, listed
separately below], 1358, 1438, 1521, 1717, 1792, 1831, 1890, 1983, 1995, 2030,
2052, 2088, 2122, 2167, 2212, 2228, 2311, 2324, 2355, 2460, 2483, 2523, 2543,
2571, 2712, 2739 — the smaller, more numerous cards/tags/inputs across nearly
every panel). It's consistently 2px under `radius-sm`(6). Either the scale is
missing a `radius-xs(4px)` step, or all 28 need to visibly bump to 6px — that's
a real design decision, not a mechanical one, and should be made explicitly
before 7.13 touches this.

Other non-exact radius values:
- 539 `.task-bar-track` 5px → sm(6), Δ1
- 869, 915 `.calibration-track`, `.pattern-tile` → already exact (10px, tokenized)
- 892 `.calibration-indicator` 3px → sm(6), Δ3
- 997 `.rotation-needle` 2px → sm(6), Δ4
- 2030, 2122 `.admin-role-tag`, `.admin-reason/.admin-status/.admin-banned-tag` 3px → sm(6), Δ3
- 2782 `.voice-hud` 8px → equidistant sm(6)/md(10), Δ2 each
- 2838, 2876 `.voice-silenced`, `.voice-mic-toggle/.voice-peer-mute/.voice-leave` 5px → sm(6), Δ1

`50%`, `999px` pill/circle shapes throughout are not scale candidates (shape
keywords, not radii).

---

## 5. Duration debt

Scale: fast=60ms · base=120ms · slow=300ms · scene=1200ms. Exact matches
tokenized in this pass: `index.css` `.task-bar-fill` transition (300ms →
`--duration-slow`); `RotationGame.tsx:31`, `CalibrationGame.tsx:56`,
`CalibrationGame.tsx:59` (all 300ms → `duration.slow`);
`PhaseAtmosphere.ts` `BODY_FOUND_SHAKE.duration` (120ms → `duration.base`).

### 5a. `client/src/index.css`

| Line | Selector | Raw | ms | Nearest |
|---|---|---|---|---|
| 80 | `.loading-spinner` animation | 0.9s | 900 | scene(1200), Δ300 |
| 837, 838 | `.code-entry-slot` transition (×2) | 0.2s | 200 | base(120), Δ80 |
| 870 | `.calibration-track` transition | 0.2s | 200 | base(120), Δ80 |
| 917 | `.pattern-tile` transition | 0.15s | 150 | base(120), Δ30 |
| 1198 | `.meeting-layout::before` animation | 5s | 5000 | scene(1200), Δ3800 |
| 2864 | `.voice-meter-fill` transition | 90ms | 90 | equidistant fast(60)/base(120), Δ30 each |

### 5b. TS/TSX

| File | Line | Raw (ms) | Context | Nearest |
|---|---|---|---|---|
| `App.tsx` | 473 | 4000 | invite-link error banner dismiss | scene(1200), Δ2800 |
| `App.tsx` | 483 | 5000 | moderation notice dismiss | scene(1200), Δ3800 |
| `GameView.tsx` | 36, 199 | 6000 (`HINT_TOAST_MS`) | ability-hint toast lifetime | scene(1200), Δ4800 |
| `useOnboardingHint.ts` | 6, 30 | 6000 (`HINT_DURATION_MS`) | onboarding hint lifetime — **exact duplicate of `HINT_TOAST_MS` above, confirmed by the file's own comment** | scene(1200), Δ4800 |
| `LobbyRoom.tsx` | 89, 110 | 1500 (×2, "copied" reset) | scene(1200), Δ300 |
| `FriendsPanel.tsx` | ~170 | 2000 ("just invited" reset) | scene(1200), Δ800 |
| `AbilityButton.tsx` | 53 | 200 (cooldown tick interval) | tie: base(120) Δ80 / slow(300) Δ100 |
| `useCountdown.ts` | 20 | 250 (generic countdown tick) | slow(300), Δ50 |
| `OrderingGame.tsx` | 44 | 200 (onComplete delay) | tie: base(120) Δ80 / slow(300) Δ100 |
| `WireConnectingGame.tsx` | 79 | 250 (onComplete delay) | slow(300), Δ50 |
| `CalibrationGame.tsx` | 6 | 1400 (`SWEEP_MS`) | scene(1200), Δ200 |
| `CodeEntryGame.tsx` | 42 | 500 (error-shake reset) | slow(300), Δ200 |
| `PatternMemoryGame.tsx` | 7 | 550 (`FLASH_MS`) | slow(300), Δ250 |
| `PatternMemoryGame.tsx` | 8 | 250 (`GAP_MS`) | slow(300), Δ50 |
| `PatternMemoryGame.tsx` | 40 | 400 (`FLASH_MS - 150`, computed) | slow(300), Δ100 |
| `PatternMemoryGame.tsx` | 66 | 700 (wrong-input reset) | tie: slow(300) Δ400 / scene(1200) Δ500 |
| `PhaseAtmosphere.ts` | 45, 227 | 9000 (`LIGHTHOUSE_BEAM_ROTATE_MS`) | scene(1200), Δ7800 |
| `PhaseAtmosphere.ts` | 77 | 220 (`SABOTAGE_SHAKE.duration`) | tie: base(120) Δ100 / slow(300) Δ80 |

**Needs human judgment, not a single value to snap:**
- `PatternMemoryGame.tsx:41,48` — computed stagger/total-playback expressions built from `FLASH_MS`
- `PhaseAtmosphere.ts:310,314` — `Phaser.Math.Between(2600,4200)` / `Phaser.Math.Between(0,2000)`, randomized puddle-shimmer ranges
- `GameScene.ts:1145` — `450 + Math.random() * 200`, death-effect particle burst

**Dedup opportunities independent of the token scale:**
1. `HINT_TOAST_MS` (`GameView.tsx`) and `HINT_DURATION_MS` (`useOnboardingHint.ts`) are the same `6000` for the same concept — merge into one exported constant.
2. `LobbyRoom.tsx`'s two `1500`s (room code vs. invite link copy) and `FriendsPanel.tsx`'s `2000` (invite) are all "revert a transient confirmation state" — worth reconciling to one shared constant even before any token-scale decision.
3. `RotationGame.tsx:31` and `CalibrationGame.tsx:56` already matched `duration.slow` exactly; `CalibrationGame.tsx:59` too. `OrderingGame.tsx`(200) and `WireConnectingGame.tsx`(250) look like unintentional near-misses of the same "minigame success → onComplete" beat rather than deliberate differences — candidate to converge on `duration.slow` in 7.13 rather than leave as three near-identical-but-not-quite values.

---

## 6. What's already done

- `client/src/theme/tokens.ts` — source of truth for all of §3/§7 plus spacing/radius/duration.
- `client/src/theme/tokens.css` — generated from `tokens.ts` via `npm run tokens:build -w client` (also runs automatically before `npm run build`). Never hand-edit; regenerate.
- `client/src/theme/phaserColor.ts` — `hexNum()`/`hexToRgbTriplet()`, the shared hex-string→Phaser-number / →rgb-triplet helpers every game-layer file now uses instead of a hand-rolled local copy (there were two before this pass, in `Havener.ts` and `havenerPlayground.ts`). Deliberately has **no** `import Phaser` — see the file's own doc comment: Phaser's module touches `window` as an OS-detection side effect, which broke `assign.test.ts` the first time this was tried with `Phaser.Display.Color`. Parsing hex by hand avoids the whole class of problem.
- `client/src/theme/colorBlindPalette.ts` and `client/src/theme/minigameTileColors.ts` — the two non-ART_BIBLE palettes, moved out of application code and (for the minigame one) deduplicated. See §1.
- `client/src/index.css` now `@import`s `tokens.css` and `ui/primitives/primitives.css`, and contains **zero** hex literals — every colour is a `var(--color-*)` token, and the transitional `--ink`/`--paper-*`/`--timber`/`--brass`/`--danger`/`--success` alias block (kept mid-pass so the file could be swept selector-by-selector) has been fully swept and deleted.
- §1 (colours) and §2 (typography) are done in full — see those sections.
- `client/src/ui/primitives/` (`Panel`, `Button`, `Card`, `Slider`) are the only styled primitives in the client, per ART_BIBLE §8. Every screen and HUD component — including the in-canvas overlays (`AbilityButton`'s kill button, `TouchControls`, `VoiceHud`, the ability/onboarding toasts, the task list, the critical-sabotage banner, `App.tsx`'s corner toggles) — renders through them now; one-off chrome (border/fill/radius/press-mechanics) was deleted from `index.css` wherever a component already supplies it, leaving only true layout/position/shape overrides (see the comments left at each such rule for why). Minigame-internal interaction pieces (keypad keys, pattern tiles, wire plugs, rotation dials, ordering-list items) are deliberately **not** forced onto `<Button>` — they're gameplay puzzle geometry with their own bespoke shapes, not menu/HUD chrome, matching how §3b/§3c below already treat minigame dimensions as their own category.
- 48px minimum interactive height and the 13px text floor are enforced site-wide, with two documented, deliberate exceptions: the 9px badge-number glyph (§2) and the 36px wire-plug/socket (§3, minigame board geometry). Both existed before this pass and are unchanged; both now say why in a comment rather than being silent debt.
- ESLint rule banning hex literals in `client/src/**` outside `theme/**` is now `"error"` (`client/eslint.config.js`) — confirmed zero violations via `npx eslint "src/**/*.{ts,tsx}"`.
- `npx tsc --noEmit`, `npx vitest run` (61 tests), and `npm run build` all pass clean after this pass.

**Still open — needs a human design decision, not a mechanical fix:** §3
(spacing near-misses, and the "is 4px missing from the radius scale" question
in §4), §4 (radius), §5 (duration near-misses and the dedup opportunities it
lists). None of these were touched in this pass; their per-line references
predate the §1/§2 rewrite above and should be re-derived (line numbers have
shifted) before anyone acts on them.
