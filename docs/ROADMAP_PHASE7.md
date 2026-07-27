# Foghaven — Phase 7: Art & Feel Overhaul

> Work order for Claude Code. 24 prompts across 7 blocks.
> **Every prompt assumes `docs/ART_BIBLE.md` has been read.** The Art Bible is the spec; this file is the schedule.
> Continues from Phase 6. Repo: `C:\dev\foghaven`.

Repo location: `docs/ROADMAP_PHASE7.md`

---

## Ground Rules

**Order matters more than usual here.** Block A produces the tokens and pipeline everything else consumes. Block B is deliberately second because it is the cheapest possible win and it fixes the thing that is actively unpleasant right now. Do not jump to the map art pass (Block F) early — it is the largest block and it will look wrong if the character, lighting, and tokens are not settled first.

**Model routing**

| Model | Use for |
|---|---|
| Fable 5 | Architecture and systemic decisions — 7.3, 7.6, 7.9, 7.14, 7.21 |
| Opus 4.8 | Anything touching game state, secrecy, or the server — 7.10, 7.15, 7.20, 7.23 |
| Sonnet 5 | Standard implementation — most prompts |
| Haiku 4.5 | Boilerplate, asset wiring, config — 7.2, 7.5 |

**Rules for every prompt**
- All code, comments, commits, and docs in English
- No hardcoded colours, sizes, or durations — everything from tokens
- Client is untrusted: no art or animation change may reveal hidden state (see 7.24)
- Full test suite green before each commit
- Nothing merges until it has been seen running, not just passing tests

**Test suite baseline entering Phase 7: 451 passing.**

---

# Block A — Foundations

Nothing else can start cleanly until these three land.

## 7.1 — Design tokens
**Model:** Sonnet 5

> Read `docs/ART_BIBLE.md` sections 3 and 7.
>
> Create `client/src/theme/tokens.ts` exporting every colour token from §3 (core, materials, light, semantic, and the 14 player lantern colours as an ordered array), the typography scale from §7, a spacing scale (4/8/12/16/24/32/48), a radius scale (6/10/12/14/20), and a duration scale (fast 60ms, base 120ms, slow 300ms, scene 1200ms).
>
> Mirror all of it as CSS custom properties in `client/src/theme/tokens.css` for the React layer, generated from the same TS source so the two can never drift.
>
> Then sweep the entire client for hardcoded hex colours, px font sizes, and magic-number durations, and replace them with tokens. Report anything that does not map cleanly to a token rather than inventing a new value.
>
> Add an ESLint rule banning hex literals in `client/src/**` outside `theme/`.

**Done when:** zero hex literals outside `theme/`; ESLint enforces it; app renders with the new palette.

## 7.2 — Typography pipeline
**Model:** Haiku 4.5

> Self-host Alfa Slab One, Nunito (700/800), and JetBrains Mono (700). Subset to Latin + Latin Extended — Turkish characters are required and must be verified (ğ, ü, ş, ı, İ, ö, ç).
>
> Add `@font-face` with `font-display: swap` and preload the two fonts used above the fold. Wire the §7 scale into both the React CSS layer and Phaser's text styles so they cannot diverge.
>
> Remove the current serif entirely.
>
> Then fix the untranslated key `lobbyRoom.settings.voteMuteEnabledLabel`, and add a CI check that fails the build if any locale file has a key present in `en` but missing or empty elsewhere.

**Done when:** no font hotlinking; Turkish glyphs render correctly; missing-translation check runs in CI.

## 7.3 — Asset pipeline and Gemini generation script
**Model:** Fable 5

> Read `docs/ART_BIBLE.md` §12 in full.
>
> Build the asset pipeline:
>
> 1. Directory structure: `art/prompts/` (committed), `art/generated/` (gitignored), `art/approved/` (committed), `client/public/assets/atlas/` (build output).
>
> 2. `scripts/genart.mjs` — a Node script that:
>    - reads `GEMINI_API_KEY` from `.env` (fail with a clear message if absent; verify `.env` is gitignored)
>    - takes a prompt name, resolves `art/prompts/<name>.txt`, and appends the §12.2 style block verbatim
>    - supports `--model pro|flash|lite` mapping to `gemini-3-pro-image-preview`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`
>    - supports `--refs a,b,c` to pass approved assets as reference images (Pro only)
>    - supports `--n <count>`, writing to `art/generated/<name>/<ISO-timestamp>-<i>.png`
>    - writes a `.meta.json` sidecar alongside each output recording prompt file, full resolved prompt, model, refs, and timestamp
>    - prints an estimated cost before running and requires confirmation above a configurable threshold
>
> 3. `scripts/approve.mjs <generated-path> <asset-name>` — moves a chosen output to `art/approved/`, carrying its meta forward.
>
> 4. `scripts/cleanup.mjs` — the §12.5 pass: background removal by alpha threshold, palette snap to the §3 token set, outline colour normalisation to `#1A1620`, and downscale to a per-asset target. Palette snapping must be automatic and scripted, never manual.
>
> 5. `npm run atlas` — packs `art/approved/` into texture atlases with a generated TS manifest so asset keys are typed.
>
> Do not commit an API key. Do not call the API from client code — this is a build-time tool only.

**Done when:** `node scripts/genart.mjs character-base --model pro --n 4` produces four images with sidecars; `npm run atlas` produces a typed manifest.

---

# Block B — Audio

Do this second. It is roughly a day of work and it fixes the single most complained-about thing in the current build.

## 7.4 — Layered ambience system
**Model:** Sonnet 5

> Read `docs/ART_BIBLE.md` §11.
>
> Replace the current looping music entirely. Build an `AudioDirector` that manages four ambience layers (`bed`, `sea`, `town`, `dread`), each an independent looping stem with its own gain node.
>
> The director subscribes to game state and crossfades layer gains over 2–3 seconds according to the §11.2 mix table. It must never hard-cut. Room type applies a low-pass to the `town` layer when indoors.
>
> No melodic content anywhere. If a stem has a discernible tune, it is the wrong stem.
>
> Add a master volume plus independent music / SFX / voice sliders, persisted to local storage, and make sure they actually apply to voice chat gain too.

**Done when:** a full round can be played without the audio becoming irritating; every state transition is a fade, not a cut.

## 7.5 — Stinger library and mix ducking
**Model:** Haiku 4.5

> Implement the §11.3 stinger library as a preloaded sprite sheet with a single `playStinger(key)` API. Every playback applies ±4% random pitch variation.
>
> Implement automatic ducking: ambience drops to 15% during meetings, and ducks under proximity voice whenever a nearby peer is transmitting.
>
> Own footsteps only, quiet. **No footstep audio for other players** — it leaks positional information the fog exists to hide. Add a test asserting no remote-player position triggers a local sound.

**Done when:** all 17 stingers fire from their events; the anti-leak test passes.

---

# Block C — Character

## 7.6 — Character rig architecture
**Model:** Fable 5

> Read `docs/ART_BIBLE.md` §4.
>
> Replace the current single-sprite character with the §4.2 layered composite. Build a `Havener` Phaser container with the nine-layer stack in the specified z-order, and the six named anchor points from §4.3 as fixed offsets in a single exported constant.
>
> Cosmetics attach by anchor name and must be swappable at runtime without rebuilding the container. The lantern layer is runtime-tinted with the player's colour from the §3.5 array; the glow overlay is an additive sprite tinted to match.
>
> Two-direction facing only (§4.5) — left and right, horizontally mirrored. Do not build four-direction.
>
> Ship with placeholder art if the real sprite is not ready. The architecture is what matters in this prompt.

**Done when:** a Havener renders as a composite; swapping a hat at runtime does not touch any other layer; lantern tint changes with player colour.

## 7.7 — Animation state machine
**Model:** Sonnet 5

> Implement the six states in §4.4 as tweens on the rig from 7.6. No frame-by-frame sprite animation anywhere.
>
> Every duration and amplitude comes from a config object, not inline numbers, so they can be tuned without a rebuild.
>
> The `death` state is the priority: squash, then the lantern **detaches from the rig**, falls under gravity, bounces once, rolls, and its glow fades to zero over 400 ms. Spend real time on this one — it is the signature moment of the game.
>
> Add a dev-only playground route that renders one Havener with buttons for every state and live sliders for each timing value.

**Done when:** the playground exists; the death animation looks good enough that you want to watch it twice.

## 7.8 — Lantern and per-player light
**Model:** Sonnet 5

> Each Havener emits a light in their own colour. Wire this into the vision system rather than bolting it on: a player's own vision radius (§6.2) originates from their lantern.
>
> Implement lantern states: `lit` (normal), `flickering` (low oil / Stranger tell, if the design calls for it), `extinguished` (voluntarily doused — smaller vision radius, much harder for others to see you), `dropped` (detached, on the ground, fading).
>
> Extinguishing is a real tactical choice: you become hard to see, and you also become nearly blind. Make sure both halves are actually felt in play.
>
> Server is authoritative for lantern state. The client renders what the server says and never predicts it.

**Done when:** 14 players in one room are individually identifiable by light colour through fog; extinguishing is a meaningful trade.

---

# Block D — Feel

## 7.9 — Juice layer
**Model:** Fable 5

> Read `docs/ART_BIBLE.md` §9.
>
> Build a central `JuiceDirector` exposing `shake(px, ms)`, `hitStop(ms)`, `flash(colour, alpha, ms)`, `punch(target, scale, ms)`, and `vignette(intensity, ms)`. Every effect in the §9 table routes through it — no ad-hoc camera calls scattered through gameplay code.
>
> Hit-stop must pause visual updates without pausing the network clock or desyncing server state. This is the part to get right.
>
> Add a global reduced-motion setting that scales all amplitudes to zero while preserving durations, and respect `prefers-reduced-motion` by default.

**Done when:** every §9 row fires; reduced-motion produces no shake or flash; no desync under repeated hit-stops.

## 7.10 — Kill cutscene
**Model:** Opus 4.8

> Implement §10.1 as a timeline, not a state transition. Five beats, 1.4 s total.
>
> The blood splash is a hand-drawn ink-splatter sprite in the angular style reserved for danger — not a particle system.
>
> **Security:** the cutscene plays only for the killer and the victim. It must not be constructible, inferable, or timing-detectable by any other client. Audit what the server sends during the kill window and confirm no third party receives anything they could not already derive. Add tests for this specifically, including a test that measures whether message timing alone leaks the event.

**Done when:** the cutscene lands; the leak tests pass; a modified client observing all traffic cannot determine that a kill occurred elsewhere on the map.

## 7.11 — Ejection cutscene
**Model:** Sonnet 5

> Implement §10.2 — the pier, the walk into the fog, the shrinking lantern, the light going out, the bell, the reveal text. Roughly 3.5 s.
>
> Use `art/approved/cutscene-pier.png` as the backdrop with the three-layer parallax fog from §6.1 running over it.
>
> The reveal line respects the existing `Atılan oyuncunun tarafını göster` lobby setting — when off, the second line is omitted entirely and no timing difference betrays what it would have said.
>
> Add a skip on any input after 1.5 s, with per-client skip — one player skipping must not affect anyone else.

**Done when:** it reads as a scene rather than a transition; the reveal setting is honoured with no timing tell.

## 7.12 — Meeting call cutscene
**Model:** Sonnet 5

> Implement §10.3 — the ring of flaring lanterns against black, the bell toll, the title slam, the discussion UI sliding up. About 1.8 s.
>
> Two variants: body reported (header names the room where the body was found) and emergency button (header names the caller). Both use the same timeline.

**Done when:** both variants play; the transition into the discussion UI is continuous with no flash of unstyled state.

---

# Block E — Interface

## 7.13 — Component kit
**Model:** Sonnet 5

> Read `docs/ART_BIBLE.md` §8.
>
> Build `Panel`, `Button`, `Card`, and `Slider` as the only styled primitives in the client. The Button's 5 px `ink` thickness bar and its 60 ms press collapse are what make it feel like a game button — implement them exactly.
>
> Then rebuild every existing screen out of these four. Delete all one-off styling as you go. Nothing in the client should be a bare `div` with inline styles when you are done.
>
> Enforce the 48 px minimum interactive height everywhere. Audit for anything currently below 13 px of text and fix it.

**Done when:** four primitives, zero one-off component styles, all touch targets ≥ 48 px.

## 7.14 — Lobby as a playable room
**Model:** Fable 5

> The lobby is currently an HTML form. Replace it with a walkable space — this is the single largest experiential gap against the reference games.
>
> The lobby is the Tavern interior (§5.2). Players spawn in it as their Havener and can walk around and see each other before the round starts. The host is marked with a `voteGold` crown above their nameplate.
>
> Ready state is physical: stand on the marked flagstone by the door. A green check appears above ready players. The host's Start button unlocks when the minimum is met.
>
> The settings panel becomes an overlay opened from a table in the room, not the primary interface. The room code and invite buttons stay pinned as a small persistent HUD element.
>
> Preserve every existing lobby feature — room code, invite link, friend invites, role toggles, balance sliders, the presets. This is a presentation change, not a feature removal. Confirm feature parity explicitly before finishing.

**Done when:** you can walk around the tavern with friends before a round, and nothing from the old lobby has been lost.

## 7.15 — Role selection screen
**Model:** Opus 4.8

> New mechanic, adapted from Goose Goose Duck. After faction assignment but before the round starts, each player is offered a choice of roles from within their own faction.
>
> Flow: players are prompted in a randomised order. Each is offered 3 role cards plus a Random card, each with its emblem (§12.3 role-emblems) and a single-line description. A timer runs; on expiry, Random is taken. Other players see only that someone is picking and who has finished — never what was offered or what was chosen.
>
> Cards use the §8 Card primitive with the `voteGold` selected state.
>
> **Security is the whole prompt.** The set of roles offered to a player leaks faction information if any part of it is visible to others. The server sends each client only its own options. Test that a modified client cannot learn another player's offered set, their choice, their faction, or even the size of their option list. Test that pick timing is not correlated with faction.
>
> Add a lobby setting to disable role selection entirely and fall back to the current random assignment.

**Done when:** the flow works for 14 players; every leak test passes; the toggle cleanly reverts to old behaviour.

## 7.16 — Discussion and voting screen
**Model:** Sonnet 5

> Replace the text list with a grid of player Cards (§8). Each card shows the player's Havener sprite in their lantern colour, their name, their vote pips, and a speaking indicator driven by proximity voice.
>
> Dead players: desaturated, `ink` X overlay, cannot be voted for.
> Header: the meeting cause — the room where the body was found, or the name of the caller.
> A `voteGold` timer bar spans the top.
> `SKIP` is a first-class Button, not a small link.
>
> Voting: card punches on selection, a pip drops in with a bounce, and votes stay hidden until the timer ends if the lobby is set to anonymous voting.

**Done when:** the screen reads at a glance during a 45-second timer; anonymous voting reveals nothing early.

## 7.17 — Round end screen
**Model:** Sonnet 5

> Rebuild on the §10 language. The losing side's lanterns extinguish one by one, 80 ms apart, before the result title slams in.
>
> Then the roster with each player's role emblem and faction, followed by the round summary and voting history — all in Cards, collapsible so the screen is not a wall on first view.
>
> Keep the report button on each player row and the return-to-lobby flow exactly as they are.

**Done when:** the ending has a beat of drama before the data appears.

---

# Block F — World

The largest block. Do not start it before Blocks A through D are done.

## 7.18 — Fog and lighting rework
**Model:** Sonnet 5

> Read `docs/ART_BIBLE.md` §6.
>
> Replace the single radial gradient with:
>
> 1. Three parallax noise fog layers per §6.1. The near layer renders **above** characters — this is the detail that makes it read as weather.
> 2. A darkness mask with short 24 px falloff, punched by light sources. Radii from §6.2. The sabotage transition animates over 1.2 s.
> 3. The Lighthouse Beam (§6.3) — a rotating wedge, one sweep every 40 s, briefly revealing whatever it crosses, visible to everyone.
>
> The beam is server-driven with a deterministic phase seeded per round, so every client sees it in the same place at the same time. It is a real gameplay element, not decoration: being caught by it standing over a body should be a genuine risk.
>
> Profile on mobile. If the three fog layers cost too much, drop the far layer on low-end devices rather than reducing the near one.

**Done when:** fog reads as weather; the beam is synchronised across clients; mobile holds frame rate.

## 7.19 — Room art pass
**Model:** Sonnet 5

> Work through the §5.2 table one room at a time. For each room:
>
> 1. Generate the props sheet via `art/prompts/props-<room>.txt`
> 2. Generate the background plate via `art/prompts/room-<name>-plate.txt`
> 3. Run the §12.5 cleanup pass on both
> 4. Reshape the room's collision geometry to its assigned non-rectangular silhouette
> 5. Hand-place 4–8 props
> 6. Place the room's in-world light source and wire it to the lighting system
>
> **Delete the in-world room name text** once a room's art lands. Names stay on the minimap and in meeting headers only.
>
> Commit one room per commit. Do not batch — if the style drifts you want to be able to see exactly where.

**Done when:** all ten rooms have shape, palette, props, and light; no text labels remain on the playfield.

## 7.20 — Map graph audit
**Model:** Opus 4.8

> Independent of art. Audit the map against §5.3 and produce a written report before changing anything:
>
> - list every room with only one connection
> - list every room pair with only one route between them
> - identify sightlines longer than 1.5 screen widths
> - map the vent/shortcut graph against the walking graph and find where they trivially coincide
>
> Then propose changes, with reasoning, and wait for approval before implementing. Do not silently redesign the map.
>
> Add an automated test that fails if any room has fewer than two connections, so future map edits cannot reintroduce a dead end.

**Done when:** the report exists, changes are approved and applied, and the connectivity test is in CI.

---

# Block G — Tasks

## 7.21 — Task minigame framework
**Model:** Fable 5

> Tasks are currently "walk to a place". They need to be interactive minigames.
>
> Build a framework where each minigame is a self-contained module declaring its id, display name, duration band (short / long), whether it is *visual* (see 7.23), and a mount/unmount lifecycle against a standard overlay.
>
> **The server owns completion.** The client reports an attempt; the server validates plausibility — elapsed time within expected bounds, correct station, player alive and in range, not already complete — and only then increments progress. A client must not be able to complete a task instantly or remotely. Assume the client is hostile.
>
> Add the framework with one reference minigame, and tests covering the rejection paths.

**Done when:** the framework exists; a modified client cannot complete a task it did not actually perform.

## 7.22 — First six minigames
**Model:** Sonnet 5

> Build six minigames on the 7.21 framework, all themed and all built from §8 primitives:
>
> 1. **Trim the Wick** — rotate a dial to bring a flame to the right height (short)
> 2. **Mend the Net** — drag rope ends to matching knots (long)
> 3. **Wind the Lighthouse Gear** — a rhythm hold, release at the right moment (short)
> 4. **Pump the Bilge** — repeated timed presses against a rising water line (long)
> 5. **Sort the Ledger** — drag entries into the right column (long)
> 6. **Ring the Bell** — repeat a 4-note pattern back (short)
>
> Each needs its own success and failure feel, and each must be finishable in under 12 seconds by someone who knows it. Anything longer and players stop doing tasks.

**Done when:** all six are playable, distinct, and quick.

## 7.23 — Visual tasks
**Model:** Opus 4.8

> The highest-value deduction mechanic in the reference games, and currently absent.
>
> Implement three tasks that produce an animation other nearby players can see, so completing one in front of a witness proves you are not a Stranger:
>
> 1. **Light the Beacon** — the room floods with warm light for 3 s, visible from adjacent rooms
> 2. **Raise the Flag** — a mast flag rises, visible across the harbour
> 3. **Sound the Foghorn** — a directional sound and visual pulse across the whole map
>
> **Strangers must be unable to fake these.** A Stranger standing at the station goes through the motions with no visible effect. Verify at the server: only a genuine completion by a Townsfolk broadcasts the effect, and the broadcast cannot be forged or replayed by a client.
>
> Add a lobby setting to disable visual tasks, since they meaningfully shift balance toward the Town.

**Done when:** the three effects are visible to witnesses; a Stranger cannot trigger any of them by any client-side means; the balance toggle works.

## 7.24 — Anti-leak sweep
**Model:** Opus 4.8

> Final security pass over everything Phase 7 added. Art and animation are a new and easy leak surface.
>
> Audit and test:
> - no animation state, cosmetic, or lantern behaviour differs by faction in any way visible to another client
> - the role emblem is never sent to clients that should not have it
> - cutscene triggers are not inferable from message timing, size, or ordering
> - the lighthouse beam reveals identically for everyone and cannot be locally disabled for advantage
> - fog and vision radii are enforced server-side; a client that draws more fails to receive the data
> - reduced-motion and every accessibility setting confer no informational advantage
>
> Write the tests first, then fix what they catch.

**Done when:** the suite passes and a hostile client with full traffic visibility gains nothing over an honest one.

---

## Suggested Order and Rough Pacing

| Block | Prompts | Feel gained | Effort |
|---|---|---|---|
| A — Foundations | 7.1–7.3 | none yet | 3–4 evenings |
| B — Audio | 7.4–7.5 | **large, immediate** | 1–2 evenings |
| C — Character | 7.6–7.8 | large | 4–5 evenings |
| D — Feel | 7.9–7.12 | **largest per hour** | 4–6 evenings |
| E — Interface | 7.13–7.17 | large | 6–8 evenings |
| F — World | 7.18–7.20 | large | 8–12 evenings |
| G — Tasks | 7.21–7.24 | moderate, but deepens the game most | 6–8 evenings |

Realistically two to three months of evenings. But Block B lands in the first week, and Block D is where the game stops feeling like a prototype.

**Checkpoint after Block D:** play a full round with friends before starting Block E. If it does not feel dramatically better at that point, something in Blocks A–D was skipped, and continuing into the largest blocks will only multiply the problem.
