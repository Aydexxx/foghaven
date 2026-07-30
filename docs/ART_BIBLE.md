# Foghaven — Art Bible

> Single source of truth for visual and audio direction.
> Every asset, every UI component, and every AI generation prompt derives from this document.
> If something in the game contradicts this file, the file wins — or the file gets updated. Never both.

Repo location: `docs/ART_BIBLE.md`
Companion: `docs/ROADMAP_PHASE7.md` (the work order that implements this)

---

## 1. The One-Sentence Direction

**Cozy dread.** Friendly, chunky, thick-outlined cartoon shapes — dropped into a cold, foggy, folk-horror fishing harbour at night.

The shapes are cute. The world is not. That tension is the whole identity.

**Lane reference (for calibration, not for copying):** Among Us and Goose Goose Duck for construction and readability; Cult of the Lamb and Don't Starve for the cute-shapes-dark-world tension; Over the Garden Wall for mood.

**What we are explicitly NOT doing:**
- Pixel art (wrong for the readability we need at variable zoom)
- Realistic or painterly rendering
- Gradients and soft shading on characters or props
- 3D
- Grimdark. It is spooky, not gory. Blood is stylised, never anatomical.

---

## 2. Non-Negotiable Rules

These five rules are what make everything look like it belongs to one game. Break one and the asset gets rejected.

1. **Silhouette first.** Fill any character or prop with solid black. If you cannot tell what it is, redesign it. Do not fix it with detail.
2. **Uniform thick outline.** Every object has an outline. The outline colour is always `INK` (`#1A1620`) — never pure black. Weight is uniform; it does not taper.
3. **Flat fills + exactly one shadow step.** Two tones per material, maximum. No gradients, no ambient occlusion, no soft shading. Gradients exist only in the lighting and fog layers, which sit above the world and are rendered by code, not baked into art.
4. **Rounded shapes are safe, angular shapes are threat.** Characters, buildings, and props use circles, capsules, and rounded rectangles. Sharp corners and hard angles are reserved for danger: knives, broken glass, the Stranger's kill VFX.
5. **Palette lock.** Nothing enters the game that is not in §3. If a new colour is needed, it gets added to §3 first, with a name and a token.

---

## 3. Palette

All colours are tokens. No hardcoded hex anywhere in the codebase — see `client/src/theme/tokens.ts`.

### 3.1 Core

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1A1620` | All outlines. Darkest value in the game. Never pure black. |
| `void` | `#241F2E` | Panel fills, out-of-bounds, deep interior shadow |
| `fogDark` | `#2E3A47` | Ground shadow, unlit floor |
| `fogMid` | `#3F5060` | Base ground tone |
| `fogLight` | `#5C7285` | Lit ground, walkable highlight |
| `mist` | `#8FA3B0` | Fog particles, distant silhouettes |
| `foam` | `#C3D2D8` | Highest cool value — rim light, sea foam, ghost bodies |

### 3.2 Materials

| Token | Hex | Use |
|---|---|---|
| `woodDark` | `#3B2A22` | Wood shadow step |
| `woodMid` | `#6B4A34` | Planks, crates, docks, furniture |
| `woodLight` | `#9A7050` | Wood highlight, worn edges |
| `stoneDark` | `#3A3A42` | Stone shadow step |
| `stoneMid` | `#4A4A52` | Cobbles, walls, the lighthouse base |
| `ropeTan` | `#B49A72` | Rope, nets, canvas, paper |
| `ironCold` | `#5A6470` | Metal fittings, chains, anchors |

### 3.3 Light (the game's only warm family)

| Token | Hex | Use |
|---|---|---|
| `flameCore` | `#FFF3C4` | Centre of any flame or lamp |
| `flameGlow` | `#FFC65C` | Lantern body glow, window light |
| `flameDeep` | `#E08A2E` | Outer falloff, warm bounce on ground |

### 3.4 Semantic

| Token | Hex | Use |
|---|---|---|
| `townGreen` | `#6FB08A` | Town faction, confirmed-safe, task complete |
| `strangerRed` | `#C24A4A` | Stranger faction, danger UI |
| `bloodDeep` | `#8E1B24` | Kill VFX base |
| `bloodBright` | `#E5453F` | Kill VFX highlight, critical sabotage |
| `voteGold` | `#E8B94A` | Host crown, selection outline, vote pips |

### 3.5 Player Lantern Colours

**Design decision: player identity is carried by the lantern, not the body.**

Every player wears the same desaturated oilskin coat. What distinguishes them is the colour of the light they carry. This is the single most important art decision in the project, because it:

- reads through fog at distance where a body colour would not
- justifies the theme (this is a game about light and dark)
- hooks directly into mechanics (extinguish your lantern to hide; the Lamplighter relights lamps; sabotage kills the lights)
- keeps the world palette cold and coherent while still giving 14 distinct player identities

All lantern colours sit in a narrow high-luminance band so no player is harder to see than another. Do not add colours outside this band.

| Name | Hex |
|---|---|
| Amber | `#FFB347` |
| Crimson | `#FF6B6B` |
| Rose | `#FF9FC4` |
| Violet | `#B98CFF` |
| Cobalt | `#6BA8FF` |
| Cyan | `#5FE0DC` |
| Jade | `#6FE09A` |
| Lime | `#C8F06A` |
| Bone | `#F2EAD8` |
| Rust | `#E07A4A` |
| Ash | `#9AA5B5` |
| Plum | `#9B6BAA` |
| Moss | `#8FA85C` |
| Coral | `#FFA48F` |

**Accessibility:** Amber/Rust and Rose/Coral are close. Colour must never be the *only* channel — every player card and nameplate also shows the player name, and colourblind mode adds a two-letter code beside the lantern (`AM`, `RU`, `RO`, `CO`).

**Canonical source:** the table above documents intent; `shared/config/lanterns.ts` is the implementation. If the two ever disagree, the code wins and this table is stale — update it to match. As with `character-base-01` (§4.6), there is one source of truth, not two independently maintained copies.

---

## 4. Character Construction

### 4.1 The Havener (base character)

Everyone in Foghaven — Townsfolk and Strangers alike — is a "Havener". Identical body, identical silhouette. That identity is the game.

**Silhouette recipe:**
- Overall: a rounded trapezoid, wider at the hem than the shoulders — a heavy hooded cloak
- Hood: a soft peak, rounded not pointed, casting a flat dark shape over the whole face
- Face: no visible skin. Two large warm amber glowing ovals for eyes, in the same colour family as the lantern flame, slightly offset in size (asymmetry = life). The eyes deliberately echo the lantern light — the character reads as something carrying light inside it. **No mouth.** A mouth is one detail too many, and mouthlessness is quietly unsettling — which is exactly the register we want.
- Arms: stubby, visible only from the elbow. One hand holds the lantern.
- Boots: two short rounded rectangles, no ankle detail
- Lantern: always in the front hand, always visible, glowing in the player's colour

**Proportions:** head + hood ≈ 40% of total height. Body ≈ 45%. Boots ≈ 15%. This is deliberately baby-faced — cute proportions on a hooded figure is the whole trick.

**Canvas:** 128×128 px source. Character occupies ~96 px of height, centred horizontally, feet at y=112. Rendered in-game at 0.5–0.75 scale depending on zoom.

### 4.2 Layer stack

The character is **never** drawn as one flat image. It is a composite, exactly like the Among Us cosmetic system:

```
z=0   pet          (optional, trails behind)
z=1   backItem     (cape, net, satchel)
z=2   bodyBase     (the oilskin coat — recoloured per skin, never per player)
z=3   legs         (animated separately)
z=4   face         (eyes — swappable for expressions and cosmetic visors)
z=5   headItem     (hats, hoods, crowns — anchored to hood crown)
z=6   heldItem     (lantern — tinted at runtime with player colour)
z=7   glowOverlay  (additive light sprite, tinted, code-driven)
z=8   nameplate    (UI layer, always upright, never rotated)
```

### 4.3 Anchor points

Every cosmetic attaches to a named anchor. These are fixed and must never move between assets.

| Anchor | Position (in 128×128 source) | Attaches |
|---|---|---|
| `crown` | (64, 26) | hats, headwear |
| `face` | (64, 46) | eyes, visors, masks |
| `chest` | (64, 70) | badges, role emblems |
| `hand` | (44, 78) | lantern, tools |
| `back` | (64, 66) | capes, satchels |
| `feet` | (64, 112) | pets, shadow, footprint VFX |

### 4.4 Animation — rig, not frames

**Do not generate animation frames with AI.** It cannot hold a character consistent across frames. Every animation is a tween on the layer stack, driven in code.

| State | Duration | Description |
|---|---|---|
| `idle` | 900 ms loop | Body scaleY 1.0 → 1.02 → 1.0 (ease-in-out). Lantern rotates ±3°, offset 150 ms behind the body. |
| `walk` | 450 ms loop | Body bobs ±2 px. Legs alternate ±14° from hip. Coat hem lags body by 60 ms. Lantern swings ±8°. |
| `run` | 320 ms loop | Same as walk, amplitudes ×1.4, body leans 5° into direction |
| `interact` | 400 ms once | Body squashes to scaleY 0.94, lantern raises 6 px, small `flameCore` sparkle at `hand` |
| `ghost` | 1200 ms loop | Alpha 0.45, legs hidden, hem dissolves into three drifting wisps, vertical float ±4 px. Lantern is dark. |
| `death` | 500 ms once | Squash to scaleX 1.2 / scaleY 0.8 over 80 ms, then fall. Lantern **detaches**, falls with gravity, bounces once, rolls, and its glow fades to zero over 400 ms. |

The detaching lantern in `death` is the signature moment of the whole game. Get it right.

### 4.5 Facing

Four directions is over-engineering here. Ship **two**: left and right, horizontally mirrored. Up/down movement uses the horizontal sprite. Among Us does exactly this and nobody notices.

### 4.6 Canonical reference assets

These are the approved, locked assets the character is defined by. The document describes the design; these files *are* the design.

| Asset | Role |
|---|---|
| `art/approved/character-base-01.png` | Front three-quarter. The master reference for all future generation. Pass as `--refs character-base-01`. |
| `art/approved/character-side-01.png` | Side profile, used for left/right movement. |
| `art/approved/cosmetic-hats-01.png` | The first 12-hat cosmetic sheet. |

**Any new character-adjacent asset must be generated with `character-base-01` as a reference image.** Hats, held items, back items, role emblems worn on the chest, ghost variants, cutscene poses — all of them. This is the only thing keeping a hundred separately-generated assets on-model.

**If the canonical character is ever replaced, every downstream asset has to be regenerated.** There is no partial migration: a new base means new hats, new side profile, new everything that was generated against the old one. Treat replacing `character-base-01` as a project-level decision, not an art tweak.

---

## 5. World & Map

### 5.1 Rules for every room

A room is not a rectangle with a label. Each room must have all four of:

1. **A distinct silhouette.** No two rooms are the same shape. Vary between octagonal, L-shaped, long-and-narrow, irregular. Players navigate by shape memory before they navigate by name.
2. **A dominant palette skew.** Every room tints toward one material family. See §5.2.
3. **4–8 hand-placed props** that explain what the room is for without a word of text.
4. **At least one in-world light source** — a lamp, a stove, a window, a brazier. This is what makes the room readable at all, since global light is near zero.

**Once art lands, delete the room name text from the world.** Names live only on the minimap and in the meeting UI. Text labels on the playfield are a placeholder smell.

### 5.2 Room palette assignments

| Room | Skew | Signature prop | Light source |
|---|---|---|---|
| Harbour / Wharf | `fogMid` + `ironCold` | Moored boat, coiled rope | Dock lamp posts |
| Tavern (also the lobby) | `woodMid` + `flameGlow` | Long table, hanging tankards | Hearth fire |
| Fish Market | `foam` + `ropeTan` | Gutting tables, hanging nets | Swinging bare bulb |
| Lighthouse Base | `stoneMid` + `flameCore` | Spiral stair, gear mechanism | The beam itself |
| Lamp Room | `flameDeep` heavy | Oil drums, wick trimmer bench | Every surface glows |
| Infirmary | `foam` + `townGreen` | Cots, bandage shelf | Cold lantern, blue-shifted |
| Town Hall | `woodDark` + `voteGold` | Podium, ledger, town seal | Chandelier |
| Storehouse | `woodMid` + `stoneDark` | Crates, barrels, hoist | Single high window |
| Streets (connective) | `fogDark` | Cobbles, gutter, shuttered doors | Sparse lamp posts |
| Chapel | `stoneMid` + `mist` | Pews, bell rope | Candle rows |

### 5.3 Map graph

Art will not fix a bad map. Independent of visuals, audit the layout against these:

- **Every room has at least 2 connections.** Rooms with one entrance are death traps and kill deduction, because "I was in there alone" becomes unfalsifiable.
- **Most room pairs have 2+ routes between them.** This is what makes alibis ambiguous, and ambiguity is the game.
- **Corridors are narrow and have corners.** Long sightlines destroy tension; corners create the "someone was just there" feeling.
- **One long risky traverse** across the map that saves time but is exposed. Players should have to make a choice.
- **Vent/shortcut network** (if Strangers have one) forms a separate graph that partially contradicts the walking graph.

### 5.4 Tiles & shadows

- Grid: 32 px
- Prop drop shadow: flat ellipse, `ink` at 25% alpha, **no blur**, offset 0 px vertically. Blur breaks the flat style instantly.
- Wall tops get a 4 px `ink` cap so walls read as solid against the floor.

---

## 6. Fog, Light & Vision

The current implementation is a single radial gradient. That reads as a UI mask, not weather. Replace with three cooperating systems:

### 6.1 Fog (atmosphere — cosmetic)
Three tiling noise layers scrolling at different speeds and opacities:

| Layer | Speed | Alpha | Scale |
|---|---|---|---|
| Far | 4 px/s | 0.18 | 2.0 |
| Mid | 9 px/s | 0.24 | 1.0 |
| Near | 16 px/s | 0.14 | 0.6 |

Near layer renders **above** characters. That single detail is what makes it feel like fog rather than a filter.

### 6.2 Vision (mechanic — gameplay)
A darkness mask over the world, punched through by light sources.

- Falloff is **soft but short** — 24 px, not 200 px. A long falloff feels like a blur; a short one feels like a lantern.
- Player vision radius: 180 px base. Stranger: 240 px. Lights-out sabotage: 90 px.
- The radius transition on sabotage animates over 1.2 s, not instantly. The dread is in the shrinking.

### 6.3 The Lighthouse Beam
A slow rotating wedge (one full sweep every 40 s) that briefly reveals whatever it crosses, to everyone.

This is a free, thematically perfect, high-drama mechanic: you can be caught standing over a body by the beam. It gives the map a heartbeat and it is unique to this game. Prioritise it.

---

## 7. Typography

| Role | Font | Weight | Use |
|---|---|---|---|
| Display | **Alfa Slab One** | 400 | Screen titles, "STRANGERS WIN", role reveal |
| UI | **Nunito** | 700 / 800 | Every button, label, body, chat |
| Numeric | **JetBrains Mono** | 700 | Timers, counters, room codes, vote tallies |

All three are open-licensed. **Self-host them** — do not hotlink Google Fonts. Subset to Latin + Latin Extended (Turkish characters required).

The current thin serif goes. It reads as a book, not a game, and it is not legible at a glance during a 45-second discussion timer.

### Scale

| Token | Size | Line height |
|---|---|---|
| `display-xl` | 44 | 1.1 |
| `display-lg` | 32 | 1.15 |
| `title` | 24 | 1.2 |
| `body` | 18 | 1.4 |
| `label` | 15 | 1.3 |
| `caption` | 13 | 1.3 |

**Nothing below 13 px.** The current build has text well under this and it is unreadable on mobile.

---

## 8. UI Components

Everything is built from four primitives. No one-off styling.

### Panel
- Border: 4 px `ink`
- Radius: 14 px
- Fill: `void` at 94% alpha
- Inner top highlight: 2 px `fogLight` at 15% alpha (gives the plastic-sticker depth Among Us and GGD both use)

### Button
- Border: 4 px `ink`, radius 12 px
- Body fill: `woodMid` (default) / `flameGlow` (primary) / `strangerRed` (destructive)
- **A 5 px solid `ink` bar under the body** — this fake thickness is what makes a button look pressable
- Press: translate Y +5 px, thickness bar collapses to 0. Duration 60 ms.
- Minimum height 48 px, minimum width 96 px

### Card (players, roles, cosmetics)
- Border 3 px `ink`, radius 10 px
- Selected: 4 px `voteGold` border + outer glow
- Dead: desaturate to 20%, overlay 3 px `ink` X, alpha 0.6
- Always contains the character sprite. **A player card without a face is a spreadsheet row.**

### Slider
- Track 8 px, `void`, fully rounded
- Fill `flameGlow`
- Thumb: 26 px circle, `ropeTan`, 3 px `ink` border
- Value renders in `JetBrains Mono` to the right, never inside the track

---

## 9. Juice

Feel is 30% art and 70% timing. Budget real hours for this section — it is the highest return per hour in the whole overhaul.

| Event | Effect |
|---|---|
| Any button press | Scale 1.0 → 1.06 → 1.0 over 120 ms, `back.out` easing |
| Task complete | Green ring expands from the station, progress bar pulses, soft chime |
| Task progress bar advances | Never jumps. Always tweens over 400 ms. |
| Kill | Hit-stop 80 ms → screen shake 8 px decaying over 250 ms → `bloodBright` flash at 40% for 100 ms |
| Body discovered | Hit-stop 120 ms, camera snaps to body, vignette hard-closes |
| Meeting called | Full-screen wipe, bell toll, all lanterns flare |
| Sabotage triggered | Screen edges pulse `strangerRed` at 1.5 Hz until resolved |
| Vote cast | Card punches, a `voteGold` pip drops in with a bounce |
| Ejection | See §10 |
| Round end | Losing side's lanterns all extinguish one by one, 80 ms apart |

Persistent vignette at 25%, rising to 55% during critical sabotage.

---

## 10. Signature Cutscenes

These three moments are what people will clip and share. Build them as staged sequences with their own timeline, not as state transitions.

### 10.1 The Kill (~1.4 s)
1. Fog surges inward, world darkens to near black except the two lanterns (300 ms)
2. Hit-stop. Everything freezes (80 ms)
3. A splash of `bloodDeep`/`bloodBright` in the angular, sharp-cornered style reserved for danger — hand-drawn ink splatter, not a particle system (200 ms)
4. Victim's lantern detaches, falls, bounces, rolls, glow fades out (600 ms)
5. Fog releases, world returns (200 ms)

Audio: a low swell, one wet impact, then the *clink-clink-roll* of the lantern on cobbles. That last sound is the whole scene.

### 10.2 The Ejection (~3.5 s)
The Among Us equivalent of floating into space. Ours:

1. Cut to a side-on view of the pier at night, sea and fog behind
2. The ejected Havener walks away from camera into the fog, lantern swinging
3. The silhouette shrinks; the lantern glow shrinks with it
4. Beat of stillness — just fog and the tiny light
5. The light goes out. One bell toll.
6. Text resolves in `Alfa Slab One`: `{name} was cast into the fog.` / `They were a Stranger.` or `They were not a Stranger.`

Cheap to build. Enormously more memorable than a text line. This is the shot that goes on the store page.

### 10.3 The Meeting Call (~1.8 s)
Full-screen. Every player's lantern flares to full brightness at once against black, arranged in a ring. The bell tolls. Title slams in. Then the discussion UI slides up from below.

---

## 11. Audio Direction

**No melodic loop. Anywhere.** A 30-second melody repeating for a 12-minute round is the fastest way to make people mute a game — and this is exactly the problem in the current build.

### 11.1 Ambience — layered bed, no tune

| Layer | Content | Always on? |
|---|---|---|
| `bed` | Low drone, ~55 Hz fundamental, very slow amplitude drift | Yes |
| `sea` | Waves against pilings, rigging creak, distant gull | Yes, volume varies by proximity to the water |
| `town` | Wind through alleys, a shutter, a dog far off, a rope groaning | Yes, indoor rooms low-pass this |
| `dread` | Sub-bass pulse and detuned string bed | Fades in as living player count drops, and during sabotage |

Crossfade over 2–3 s on state change. Never cut.

### 11.2 State mixing

| State | Mix |
|---|---|
| Lobby | `bed` 30%, `town` 40%, hearth crackle. Near-silence. Let people talk. |
| Round start | 1.5 s of silence, then `bed` + `sea` fade in |
| Normal play | bed 50 / sea 45 / town 40 / dread 0 |
| ≤ 4 alive | dread to 35% |
| Sabotage | dread to 70%, `town` low-passed to 400 Hz |
| Lights out | everything but `bed` ducks 60%. The quiet is the scare. |
| Meeting | ambience ducks to 15% so voice chat is clear |

### 11.3 Stinger library
`bell_toll`, `lantern_drop`, `lantern_relight`, `kill_impact`, `body_found`, `vote_cast`, `vote_lock`, `eject_walk`, `task_tick`, `task_complete`, `sabotage_alarm`, `sabotage_fixed`, `win_town`, `win_stranger`, `ui_click`, `ui_back`, `ui_error`

### 11.4 Rules
- **No footstep audio for other players.** It leaks positional information the fog is supposed to hide. Own footsteps only, and quiet — for feel, not for information.
- Duck ambience under proximity voice automatically. The WebRTC proximity voice from Phase 5 is this game's best mechanic; the mix must serve it.
- Every sound has a randomised ±4% pitch variation so repeats don't grate.
- One master volume, plus separate sliders for music/SFX/voice. Non-negotiable.

---

## 12. AI Asset Generation

### 12.1 What AI generates vs. what it does not

| Use AI for | Do NOT use AI for |
|---|---|
| Character base sprite (one canonical pose) | Animation frames — the rig handles motion (§4.4) |
| Cosmetic hats, held items, back items | Anything needing pixel-exact alignment |
| Props: crates, barrels, nets, lamps, boats | Tiling seamless tilesets (fix by hand after) |
| Role emblems and icons | UI components — code them per §8 |
| Room key art and background plates | Fonts or any text in an image |
| Cutscene backdrops (the pier, the fog) | Final palette. Always snap to §3 afterward. |
| Concept exploration | Anything shipped without a manual cleanup pass |

### 12.2 The style suffix

**Every prompt ends with this block, unchanged.** Consistency across a hundred assets comes from this, not from cleverness in individual prompts.

```
--- STYLE (append verbatim to every prompt) ---
2D game asset. Thick uniform dark outline in warm near-black #1A1620, never pure black,
constant weight, no tapering. Flat colour fills with exactly one darker shadow step.
No gradients, no soft shading, no ambient occlusion, no texture noise, no bevel.
Cute-cartoon proportions: chunky rounded shapes, oversized heads, stubby limbs.
Clean hand-drawn vector look, like a modern indie multiplayer party game.
Palette strictly limited to: cold fog blues #2E3A47 #3F5060 #5C7285 #8FA3B0 #C3D2D8,
weathered wood browns #3B2A22 #6B4A34 #9A7050, cold stone #3A3A42 #4A4A52,
and warm lantern light #FFF3C4 #FFC65C #E08A2E used only for flame and glow.
Mood: cozy dread. Friendly shapes, unsettling world. Folk-horror fishing harbour at night.
Flat plain neutral background. No scene, no environment, no text, no letters, no numbers,
no watermark, no signature, no border, no drop shadow.
```

### 12.3 Prompt pack

Each entry lives in its own file under `art/prompts/`, so that every asset in the repo can be traced back to the prompt that produced it.

---

**`art/prompts/character-base.txt`**
```
A single game character, front-facing three-quarter view, standing idle.
A short chunky figure in a heavy hooded oilskin fisherman's raincoat, dark blue-grey.
The coat is wider at the hem than at the shoulders, forming a rounded trapezoid silhouette.
A soft rounded hood casts a completely flat dark shadow over the entire face — no skin,
no nose, no mouth is visible. Only two large pale glowing oval eyes, slightly different
sizes, float in that darkness.
Stubby arms visible from the elbow. Two short rounded boots.
The left hand holds a small brass fisherman's lantern with a warm amber flame inside.
Head and hood together are roughly 40% of the total height — deliberately baby-faced
proportions on an ominous figure.
Centred, full body, feet flat, no cropping.
[append STYLE block]
```

**`art/prompts/character-turnaround.txt`**
Same as above, plus:
```
Show the same character three times in a row on one flat background: facing left,
facing forward, facing right. Identical proportions, identical coat, identical lantern
in all three. Even spacing, same baseline.
```
Then use Nano Banana Pro with `character-base` output as a reference image to lock consistency.

**`art/prompts/cosmetic-hats.txt`**
```
A sheet of 12 cartoon hats and headwear, arranged in a grid on a flat background,
each item isolated with clear space around it, all drawn at the same scale,
all viewed from the same three-quarter angle, all sized to sit on a rounded hood.
Items: fisherman's sou'wester, knitted wool beanie, tricorn hat, wreath of dried seaweed,
brass diving helmet, lamplighter's peaked cap, gull perched as a hat, crab, ship-in-a-bottle,
tin bucket, wilted flower crown, constable's helmet.
No character, no head, no body — hats only.
[append STYLE block]
```

**`art/prompts/props-<room>.txt`** (one per room in §5.2)
```
A sheet of 8 isolated cartoon props for a <ROOM NAME> in a foggy folk-horror fishing town.
Arranged in a grid on a flat background, each prop isolated with clear space,
all at consistent scale relative to a character roughly 96 pixels tall,
all viewed from the same slight top-down three-quarter angle used in 2D
top-down multiplayer games.
Props: <list 8 specific objects from the room's signature-prop entry>
No characters, no background scene, no ground plane.
[append STYLE block]
```

**`art/prompts/role-emblems.txt`**
```
A set of 14 simple circular emblem icons for character roles in a folk-horror
fishing-town game. Each emblem is a single bold symbol inside a circular
rope-bordered frame. High contrast, readable at 48 pixels.
Symbols: lit lantern, magnifying glass, medical cross made of bandages, constable's whistle,
town seal, spiral seashell, ship's wheel, oil can, hooded figure, shifting mask,
crossed knives, silenced bell, empty coat, fishing hook.
Arranged in a grid on a flat background, evenly spaced, no text.
[append STYLE block]
```

**`art/prompts/room-<name>-plate.txt`**
```
A top-down interior of a <ROOM NAME> in a foggy folk-horror fishing town,
drawn as a background plate for a 2D top-down multiplayer game.
Slight top-down three-quarter perspective. The room's floor plan is <SHAPE from §5.2>
— deliberately not a plain rectangle.
Dominant materials: <SKEW from §5.2>. One warm light source: <LIGHT from §5.2>,
casting a soft warm pool on the floor while the rest of the room stays cold and dim.
Empty of characters. No text, no labels, no room name.
[append STYLE block]
```

**`art/prompts/cutscene-pier.txt`**
```
A side-on view of a wooden pier at night, extending away from the viewer into thick fog
over dark water. Empty — no characters. Weathered wooden pilings and railings,
mooring rope, a single unlit lamp post near the viewer.
The fog swallows everything beyond the middle distance.
Wide cinematic composition, 16:9, intended as a cutscene backdrop.
Cold blue-grey fog tones only, no warm light except a faint distant glow in the mist.
[append STYLE block]
```

### 12.4 Generation workflow

1. Write or edit the prompt file under `art/prompts/`
2. `node scripts/genart.mjs <prompt-name> --model pro --refs character-base --n 4`
3. Raw outputs land in `art/generated/<prompt-name>/<timestamp>-<n>.png` — **this directory is gitignored**
4. Pick one. Move it to `art/approved/<asset-name>.png` and commit it. Approved assets are committed; generated noise is not.
5. Run the cleanup pass (§12.5)
6. `npm run atlas` packs approved assets into `client/public/assets/atlas/`

**Every approved asset needs a sidecar `<asset-name>.meta.json`** recording the prompt file, model, and reference images used. Six weeks from now you will need to regenerate one asset to match twenty others, and this file is the only thing that makes that possible.

### 12.5 Mandatory cleanup pass

Nothing ships raw. Every approved asset goes through:

1. **Background removal** — AI will not give clean alpha. Threshold and clean by hand.
2. **Palette snap** — quantise every pixel to the nearest §3 colour. Script this; do not eyeball it. This step alone is what will make a hundred separately-generated assets look like one game.
3. **Outline normalisation** — verify the outline is `#1A1620` at uniform weight. AI drifts on this constantly.
4. **Downscale** — generate at 1024+, ship at the target size, using a nearest-or-bilinear step chosen per asset.
5. **Silhouette test** — fill with black. Still recognisable? If not, reject and regenerate. No exceptions, including for assets you like.

### 12.6 Model routing

| Task | Model |
|---|---|
| Character base, turnarounds, anything needing consistency with existing assets | `gemini-3-pro-image-preview` (Nano Banana Pro) — accepts up to 14 reference images |
| Bulk prop sheets, icons, exploration | `gemini-3.1-flash-image` (Nano Banana 2) |
| Cheap first-pass ideation | `gemini-3.1-flash-lite-image` |

Model IDs change. Verify against Google's current image-generation docs before a large batch run.

---

## 13. Definition of Done

An asset is finished when all of these are true:

- [ ] Passes the black-silhouette test
- [ ] Outline is `#1A1620`, uniform weight, present on all edges
- [ ] Every pixel maps to a §3 token
- [ ] No gradient, no soft shadow, no blur baked in
- [ ] Sits correctly against its anchor points at game scale
- [ ] Readable at the smallest size it will ever be drawn
- [ ] Has a `.meta.json` sidecar
- [ ] Placed next to three existing assets, it does not look like it came from a different game

That last one is the only test that actually matters.
