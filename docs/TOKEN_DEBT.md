# Token Debt

Worklist for the visual repaint in Phase 7.13. Generated while building the
design-token system (`client/src/theme/tokens.ts` / `tokens.css`, docs/ART_BIBLE.md
§3 and §7).

## Why this file exists

The app's current UI palette (`client/src/index.css`'s root custom properties —
`--ink`, `--paper-void`, `--brass`, `--danger`, etc.) is a warm brass/parchment
theme. It does not correspond to any colour in the art bible's §3 palette (a cold
fog/lantern theme). Neither does `colorBlindPalette.ts` (Okabe-Ito set),
`characters/palette.ts` (its own slate/parchment set), or any hardcoded colour in
`GameScene.ts`, the minigames, or the atmosphere code.

Per instruction, this pass did **not** invent a mapping between the two palettes
and did **not** wrap the existing hex values in a parallel token set — that would
just be debt for 7.13 to unpick. Colours are untouched; every hex literal below is
exactly where it always was.

Spacing, radius, duration, and typography *were* tokenized in this pass, but only
where a literal's value exactly matched a scale step (delta = 0 — a pure textual
substitution with no visual change). Everything that didn't land exactly on a step
is listed below as debt, same as the colours.

An ESLint rule (`no-restricted-syntax`, `client/eslint.config.js`) now flags every
hex literal in `client/src/**` outside `theme/` as a **warning**. It's `warn`
rather than `error` because the colours aren't swept yet — flip it to `error` as
the last step of 7.13, once this list is empty.

---

## 1. Colours (untouched — full repaint scope)

### 1a. `client/src/index.css` — root palette (context, not an action item)

The existing de facto token block. Not art-bible values; kept as-is.

| Line | Var | Hex |
|---|---|---|
| 12 | `--ink` | `#ece1c8` |
| 13 | `--ink-dim` | `#b3a487` |
| 14 | `--ink-faint` | `#83745a` |
| 16 | `--paper-void` | `#16120c` |
| 17 | `--paper-base` | `#241d14` |
| 18 | `--paper-raised` | `#2c2318` |
| 19 | `--paper-sunken` | `#17120b` |
| 21 | `--timber` | `#3c2c19` |
| 22 | `--timber-light` | `#5c4527` |
| 23 | `--timber-dark` | `#241a0f` |
| 25 | `--brass` | `#c99a4c` |
| 26 | `--brass-bright` | `#e6bc70` |
| 27 | `--brass-dim` | `#8a6a3a` |
| 29 | `--danger` | `#a8402c` |
| 30 | `--danger-bright` | `#d65e42` |
| 31 | `--danger-well` | `#2c1712` |
| 33 | `--success` | `#6f8f42` |
| 34 | `--success-bright` | `#8fb85c` |

### 1b. `client/src/index.css` — hex bypassing `var()`

| Line | Selector / property | Hex |
|---|---|---|
| 223 | `.preset-button-active` — `color` | `#2a1c0a` |
| 365 | `button` — `color` (dup of 223) | `#2a1c0a` |
| 1023 | `.kill-button` — `color` | `#e8b3a5` |
| 1038 | `.kill-button-ready` — `color` | `#fff3ee` |
| 1186 | `.meeting-layout` — `background` radial-gradient stops | `#241a0f`, `#0e0a06`, `#060402` |
| 1314 | `.constable-target` — `color` (dup of 1023) | `#e8b3a5` |
| 1320 | `.constable-confirm` — `color` (dup of 1038) | `#fff3ee` |
| 1352 | `.assassin-target` — `color` (dup of 1023) | `#e8b3a5` |
| 1366 | `.assassin-confirm` — `color` (dup of 1038) | `#fff3ee` |
| 1370 | `.silenced-notice` — fallback inside `var(--danger-bright, #c0392b)` | `#c0392b` |
| 1480 | `.chat-panel-dead` — `background-image` gradient stop | `#1c1710` |
| 1728 | `.audio-mute-active` — `color` (dup of 1023) | `#e8b3a5` |
| 2133 | `.admin-reason-hate_speech`, `.admin-reason-harassment`, `.admin-banned-tag` — `color` (dup of 1023) | `#e8b3a5` |
| 2218 | `.admin-ban-button` — `color` (dup of 1038) | `#fff3ee` |
| 2802 | `.voice-join` — fallback inside `var(--ink-well, #201810)` | `#201810` |

**Bugs found in passing, unrelated to tokens:** line 2802's `--ink-well` custom
property is never defined anywhere in `:root` or `tokens.css` — the fallback
`#201810` is silently always what renders. Worth its own fix regardless of 7.13.

**Dedup opportunity independent of the repaint:** `#e8b3a5` (5×) and `#fff3ee`
(4×) are already acting as an unnamed "text-on-danger-fill" / "text-on-fill"
pair; `#2a1c0a` (2×) likewise. Naming these as local custom properties (not
art-bible tokens, just internal dedup) would be safe to do before 7.13 if wanted.

### 1c. `client/src/game/GameScene.ts`

| Line | Literal | Context |
|---|---|---|
| 79 | `0xffffff` | `FALLBACK_COLOR` |
| 99 | `0xffd166` | `TASK_MARKER_COLOR` |
| 106 | `0x8899ff` | `TOWN_HALL_MARKER_COLOR` |
| 110 | `0xdb4b3c` | `REPAIR_MARKER_BROKEN_COLOR` |
| 111 | `0x4bb35c` | `REPAIR_MARKER_FIXED_COLOR` |
| 114 | `0x14141c` | `TILE_COLOR_WALL` |
| 115 | `0x4a4a5c` | `TILE_COLOR_STREET` |
| 116 | `0x5c4a38` | `TILE_COLOR_ROOM` |
| 120 | `"#8f8fae"` | `ROOM_LABEL_COLOR` |
| 139 | `0x05070d` | `FOG_COLOR` |
| 929 | `0x000000` | badge outline `setStrokeStyle` |
| 942 | `"#000000"` | badge-number glyph text colour |
| 950 | `"#ffffff"` | player name label text colour |
| 1179 | `0x000000` | corpse-circle outline `setStrokeStyle` |
| 1185 | `"#000000"` | corpse "✕" glyph text colour |
| 1435 | `0x000000` | Town Hall marker outline |
| 1450 | `0x000000` | repair marker outline |
| 1555 | `"#ffffff"` | report-prompt text colour |
| 1556 | `"#000000aa"` | report-prompt background |
| 1623 | `"#ffffff"` | bell-prompt text colour |
| 1624 | `"#000000aa"` | bell-prompt background |
| 1707 | `"#ffffff"` | repair-prompt text colour |
| 1708 | `"#000000aa"` | repair-prompt background |
| 1764 | `0x000000` | task marker outline |
| 1769 | `"#ffd166"` | task marker label text colour (dup of `TASK_MARKER_COLOR`, redeclared as a string) |
| 1817 | `"#ffffff"` | task-interact-prompt text colour |
| 1818 | `"#000000aa"` | task-interact-prompt background |

**Dedup opportunity:** the `"#ffffff"` / `"#000000aa"` pair at 1555–1556,
1623–1624, 1707–1708, 1817–1818 is the same style object copy-pasted four times
for the report/bell/repair/interact prompts — one shared `PROMPT_TEXT_STYLE`
constant would fix this independent of the colour repaint (the font-size and
`padding: { x: 6, y: 3 }` on the same four blocks already got deduplicated onto
`typeScale.caption` in this pass, but the object itself is still copy-pasted).

### 1d. `client/src/game/atmosphere/PhaseAtmosphere.ts`

| Line | Literal | Context |
|---|---|---|
| 27 | `0x1c3a5c` | `TASK_GRADE_COLOR` — cold-blue screen grade while playing |
| 29 | `0x6e0f14` | `SABOTAGE_GRADE_COLOR` — pulsing red alarm grade |
| 267 | `0x9db4c9` | fog-wisp particle tint |

Also non-hex canvas-gradient colour strings (not hex, but same category, worth
sweeping alongside): lines 90–92, 108–110, 131–133, 142–143 —
`rgba(255,255,255,…)`, `rgba(220,230,240,…)`, `rgba(10,14,20,…)`,
`rgba(210,220,235,…)` for the glow/rain/puddle procedural textures. These are
generated at runtime, so tokenizing them means parameterizing the
gradient-builder functions, not a find/replace.

### 1e. `client/src/game/atmosphere/lightSources.ts`

| Line | Literal | Context |
|---|---|---|
| 28 | `0xffb15c` | `WARM_LAMP` — street lamp glow tint |
| 29 | `0xffc98a` | `WARM_WINDOW` — tavern window glow tint |
| 30 | `0xfff3d6` | `BEAM_WHITE` — lighthouse beam tint |

### 1f. `client/src/game/characters/palette.ts`

The character-art palette (Phaser numeric hex). Distinct in purpose from the
colour-blind badge palette below — this one colours costume art.

| Line | Literal | Context |
|---|---|---|
| 12 | `0x2c3440` | `PALETTE.slateDark` |
| 14 | `0x4a5568` | `PALETTE.slateMid` |
| 16 | `0x8a97a8` | `PALETTE.slateLight` |
| 18 | `0xe8b64c` | `PALETTE.lantern` |
| 20 | `0xdcd0b4` | `PALETTE.parchment` |
| 22 | `0xc9a882` | `PALETTE.skin` |
| 24 | `0x14181f` | `PALETTE.ink` |

### 1g. `client/src/game/characters/cosmeticVisuals.ts`

| Line | Literal | Context |
|---|---|---|
| 43 | `0xd4af37` | `COSMETIC_ACCENTS.gold` |
| 44 | `0xc4c4cc` | `COSMETIC_ACCENTS.silver` |
| 45 | `0xa8402c` | `COSMETIC_ACCENTS.scarlet` — exactly matches `index.css`'s `--danger` |

### 1h. `client/src/game/characters/rigPreview.ts`

| Line | Literal | Context |
|---|---|---|
| 74 | `0x14181f` | fallback outline colour when `shape.stroke` is unset (dup of `PALETTE.ink`) |

### 1i. `client/src/game/characters/preview.ts` (dev-only art-review harness)

| Line | Literal | Context |
|---|---|---|
| 46 | `"#fff"` | archetype-id label text colour |
| 52 | `"#aaa"` | animation-name label text colour |
| 70 | `"#1d1d26"` | Phaser `backgroundColor` |

### 1j. `client/src/game/GameCanvas.tsx`

| Line | Literal | Context |
|---|---|---|
| 93 | `"#16120c"` | Phaser `backgroundColor` — exactly matches `index.css`'s `--paper-void` |

### 1k. `client/src/game/minigames/PatternMemoryGame.tsx`

| Line | Literal | Context |
|---|---|---|
| 5 | `"#e6194b"`, `"#3cb44b"`, `"#4363d8"`, `"#f58231"` | `TILE_COLORS` — the four tile colours |

### 1l. `client/src/game/minigames/WireConnectingGame.tsx`

| Line | Literal | Context |
|---|---|---|
| 5 | `"#e6194b"`, `"#3cb44b"`, `"#4363d8"`, `"#f58231"` | `PALETTE` — identical 4-colour set to `PatternMemoryGame.tsx`, declared separately |

### 1m. `client/src/graphics/colorBlindPalette.ts`

The Okabe-Ito colour-blind-safe palette for player badges. Indexed positionally
against `PLAYER_COLORS` from `@foghaven/shared` — order-stable, must not be
resorted. Likely should become its own dedicated token set rather than merging
into the art-bible UI palette, since it answers a different question
(distinguishability under colour-vision deficiency) than "what does the world
look like."

| Line | Literal |
|---|---|
| 24 | `#E69F00` |
| 25 | `#56B4E9` |
| 26 | `#009E73` |
| 27 | `#F0E442` |
| 28 | `#0072B2` |
| 29 | `#D55E00` |
| 30 | `#CC79A7` |
| 31 | `#DDDDDD` |
| 32 | `#999999` |
| 33 | `#8B4513` |

---

## 2. Typography debt

Scale: `display-xl`=44 · `display-lg`=32 · `title`=24 · `body`=18 · `label`=15 ·
`caption`=13 (px).

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

---

## 3. Spacing debt (`gap`, `padding*`, `margin*`, `top/right/bottom/left`,
`width/height/min-width/min-height`)

Scale: xs=4 · sm=8 · md=12 · lg=16 · xl=24 · xxl=32 · xxxl=48 (px). 187 exact
matches were tokenized across `index.css` in this pass (see `git log` on that
file for the mechanical commit). Everything below did **not** match exactly and
was left as a literal.

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
- `client/src/index.css` now `@import`s `tokens.css`.
- 187 exact-match spacing/radius/duration/typography literals in `index.css`, and 8 in `GameScene.ts`/`PhaseAtmosphere.ts`/`RotationGame.tsx`/`CalibrationGame.tsx`, replaced with `var(--token)` / `tokens.ts` references — zero visual change, confirmed by pixel-exact substitution and a clean `npm run build`.
- ESLint rule banning hex literals in `client/src/**` outside `theme/**`, currently `warn` (66 current hits, all listed above) — flip to `error` once this file is empty.
