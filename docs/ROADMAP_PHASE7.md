# Foghaven — Phase 7: Art & Feel Overhaul

> Work order for Claude Code. 25 prompts across 8 blocks.
> Every prompt below is copy-paste ready. Paste the prompt, then paste the
> **Standard Footer** underneath it.
> The Art Bible (`docs/ART_BIBLE.md`) is the spec; this file is the schedule.

Repo: `C:\dev\foghaven` — worked across two machines (AYDENİZ, BROTHERS).
Remember: `.env` is gitignored, so it must be created by hand on each machine.

---

## Progress

| # | Prompt | Block | Status |
|---|---|---|---|
| 7.1 | Design tokens | A | Done — `52ac81f` |
| 7.2 | Typography pipeline | A | Done — `570d9dd` |
| 7.3 | Asset cleanup + atlas | A | |
| 7.4 | Remove current music | A | |
| 7.5 | Character rig architecture | B | **stop here and check in** |
| 7.6 | Animation state machine | B | |
| 7.7 | Lantern & per-player light | B | |
| 7.8 | Juice layer | C | |
| 7.9 | Kill cutscene | C | |
| 7.10 | Ejection cutscene | C | |
| 7.11 | Meeting call cutscene | C | |
| — | **Playtest checkpoint** | — | play a real round with friends |
| 7.12 | Component kit | D | |
| 7.13 | Lobby as a playable room | D | |
| 7.14 | Role selection screen | D | |
| 7.15 | Discussion & voting screen | D | |
| 7.16 | Round end screen | D | |
| 7.17 | Fog & lighting rework | E | |
| 7.18 | Room art pass | E | |
| 7.19 | Map graph audit | E | |
| 7.20 | Task minigame framework | F | |
| 7.21 | First six minigames | F | |
| 7.22 | Visual tasks | F | |
| 7.23 | Layered ambience system | G | needs audio assets sourced first |
| 7.24 | Stinger library & ducking | G | needs audio assets sourced first |
| 7.25 | Anti-leak sweep | H | |

**Audio moved to Block G.** It was originally second, on the theory that it was
the cheapest win. That was wrong: the code is easy, but sourcing four ambience
stems and seventeen stingers is an afternoon of hunting, not a coding task.
7.4 kills the current annoying loop immediately, so the wait costs nothing.

---

## Standard Footer

Paste this after **every** prompt below.

```
Before finishing:
- Run `npm test` from the REPO ROOT, not from client/ or server/. Report the total
  test count. It must be 451 or higher. Running vitest from a subdirectory only
  runs that workspace's tests and will report a falsely small number.
- Run typecheck, eslint, and a production build. All must be clean.
- Commit with a descriptive message. Do not push.
- Stay strictly inside this task's scope. If you find something broken that is out
  of scope, report it at the end rather than fixing it.
- If a decision in this prompt seems wrong once you're in the code, stop and tell me
  rather than working around it silently.
```

If a root `npm test` script doesn't exist yet, 7.3 adds it.

---

## Model Routing

| Model | Prompts |
|---|---|
| Fable 5 | 7.3, 7.5, 7.8, 7.13, 7.20 — architecture and systemic decisions |
| Opus 4.8 | 7.9, 7.14, 7.19, 7.22, 7.25 — game state, secrecy, server trust |
| Sonnet 5 | everything else |

---

## Rules

- All code, comments, commits, and docs in English.
- No hardcoded colours, sizes, or durations — everything from `client/src/theme/tokens.ts`.
- The client is untrusted. No art or animation change may reveal hidden state.
- One commit per prompt. Never batch two prompts into one commit.
- Don't skip ahead. Block E (world) in particular will look wrong and need redoing
  if Blocks A–C aren't settled first.

---

# Block A — Foundations

## 7.3 — Asset cleanup pass and atlas pipeline
**Model:** Fable 5

Half of this landed already: `scripts/genart.mjs`, `scripts/approve.mjs`, and the
`art/` directory structure exist and are committed. This finishes the rest.

```
Read docs/ART_BIBLE.md section 12, especially 12.5.

The generation half of the asset pipeline already exists: scripts/genart.mjs,
scripts/approve.mjs, and art/prompts/ + art/generated/ + art/approved/. Do not
rewrite those. This task adds the two missing pieces.

1. scripts/cleanup.mjs — the section 12.5 pass, run against files in art/approved/.
   It takes an asset name and produces a cleaned version, writing to
   art/approved/<name>.clean.png so the original is never destroyed:

   a. Background removal. AI output does not have clean alpha. Detect the flat
      background colour from the image corners, then remove it with a tolerance
      threshold. Handle anti-aliased edges — a hard threshold leaves a halo.
   b. Palette snap. Quantise every remaining pixel to the nearest colour in the
      ART_BIBLE section 3 token set, imported from client/src/theme/tokens.ts so
      there is one palette definition in the repo, not two. Use perceptual distance
      (CIELAB / deltaE), not naive RGB distance — RGB distance produces visibly
      wrong matches on dark colours, which is most of our palette.
   c. Outline normalisation. Find near-black outline pixels and snap them to the
      exact ink token, at uniform opacity.
   d. Downscale to a target size passed as an argument, defaulting to 128px on the
      long edge.

   Print a before/after summary: how many distinct colours before, how many after,
   how many pixels were made transparent. If the palette snap changes more than 40%
   of non-transparent pixels, warn loudly — that means the source drifted far from
   the palette and should probably be regenerated rather than corrected.

2. npm run atlas — packs everything in art/approved/ into texture atlases under
   client/public/assets/atlas/, and generates a TypeScript manifest so asset keys
   are typed rather than magic strings. Prefer .clean.png over .png where both exist.

3. Add a root-level `npm test` script that runs the test suites of every workspace
   (client, server, and shared if it has one) and reports a combined total. Running
   vitest from a single subdirectory has already caused two commits to be verified
   against only 2 of 451 tests. Make the root script the obvious one to run.

Then run cleanup.mjs against the three existing approved assets — character-base-01,
character-side-01, cosmetic-hats-01 — and report the before/after summary for each
WITHOUT committing the cleaned output yet. I want to see the numbers first.
```

## 7.4 — Remove the current music
**Model:** Sonnet 5

Tiny task, but do it now rather than waiting for Block G.

```
Remove the current looping background music entirely — lobby and in-game, every code
path that starts it, and the audio files themselves if they are only used for this.
Leave the game silent.

Do NOT build any replacement audio system. The layered ambience system is a later block
and will be built from scratch there. Silence is the intended state until then.

Leave existing sound effects alone if any exist — this is about the music loop only.
```

---

# Block B — Character

## 7.5 — Character rig architecture
**Model:** Fable 5
**Stop after this one and check in before continuing.** Everything in Blocks B and C
hangs off these decisions.

```
Read docs/ART_BIBLE.md section 4 in full.

Replace the current single-sprite character with a layered composite.

FIRST: present your architecture plan and wait for approval before writing any
implementation code. Cover how you'll structure the container, how cosmetics attach and
swap, how the two facing directions work, and how this interacts with the existing
GameScene player rendering and the server's player state. Flag anything in ART_BIBLE
section 4 that doesn't survive contact with the existing code.

Once approved, implement:

- A Havener Phaser container with the nine-layer z-order stack from section 4.2.
- The six named anchor points from section 4.3, defined once as an exported constant.
  Nothing may hardcode an anchor offset anywhere else.
- Cosmetics attach by anchor name and swap at runtime without rebuilding the container
  or touching sibling layers.
- The lantern layer is runtime-tinted with the player's colour from the lantern colour
  array in tokens.ts. The glow overlay is an additive sprite tinted to match.
- Two-direction facing only, left and right, horizontally mirrored per section 4.5.
  Do not build four-direction movement.

Use art/approved/character-base-01.png and character-side-01.png, preferring the
.clean.png versions if 7.3 has produced them.

The architecture matters more than the visuals in this task. If the sprites need slicing
into layers and that isn't done yet, use placeholder rectangles for individual layers and
make the structure correct — real art can be swapped in later without touching the
architecture.
```

## 7.6 — Animation state machine
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 4.4.

Implement the six animation states as tweens on the 7.5 rig: idle, walk, run, interact,
ghost, death. No frame-by-frame sprite animation anywhere.

Every duration, amplitude, and easing lives in a single config object rather than inline
in the tween calls, so the feel can be tuned without hunting through files.

The death state is the priority. Squash, then the lantern DETACHES from the rig, falls
under gravity, bounces once, rolls, and its glow fades to zero over 400ms. This is the
signature moment of the game — spend real time on it and don't settle for the first
version that technically works.

Add a dev-only playground route rendering one Havener with a button per state and a live
slider for every value in the config object. This is how the animation actually gets
tuned, so it needs to be genuinely usable, not a debug dump.
```

## 7.7 — Lantern and per-player light
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md sections 3.5 and 6.2.

Every Havener emits light in their own colour. Wire this into the vision system rather
than layering it on top: a player's own vision radius originates from their lantern.

Lantern states:
- lit — normal
- flickering — a visual tell, reserved for future use; implement the state but don't wire
  it to any game condition yet
- extinguished — voluntarily doused: much harder for others to see you, and your own
  vision radius drops sharply. Both halves must be felt in play; if it's purely an
  advantage, it's a broken mechanic.
- dropped — detached and on the ground, glow fading, from the death animation

The server is authoritative for lantern state. The client renders what the server sends
and never predicts or infers it.

Verify that 14 players standing in one room are individually distinguishable by light
colour through fog. If they aren't, report it — the colour set may need adjusting, and
that's an ART_BIBLE change, not something to fix by improvising new colours here.
```

---

# Block C — Feel

## 7.8 — Juice layer
**Model:** Fable 5

```
Read docs/ART_BIBLE.md section 9.

Build a central JuiceDirector exposing: shake(px, ms), hitStop(ms),
flash(colour, alpha, ms), punch(target, scale, ms), vignette(intensity, ms).

Every effect in the section 9 table routes through it. No ad-hoc camera calls or one-off
tweens scattered through gameplay code — if something shakes the screen and doesn't go
through JuiceDirector, that's a bug.

hitStop must pause visual updates WITHOUT pausing the network clock or desyncing server
state. This is the part that is easy to get subtly wrong. Test it under repeated rapid
hit-stops.

Add a global reduced-motion setting that scales all amplitudes to zero while preserving
durations, and respect prefers-reduced-motion by default. Durations must be preserved so
timing-dependent gameplay stays identical — a player with reduced motion must not gain or
lose any information or timing advantage.
```

## 7.9 — Kill cutscene
**Model:** Opus 4.8

```
Read docs/ART_BIBLE.md section 10.1.

Implement the kill as a five-beat timeline, roughly 1.4s total — not as a state
transition.

The blood splash is a hand-drawn angular ink-splatter sprite, the sharp-cornered style
ART_BIBLE section 2 reserves for danger. Not a particle system.

SECURITY IS THE MAIN CONCERN HERE. The cutscene plays only for the killer and the victim.
It must not be constructible, inferable, or timing-detectable by any other client. Audit
exactly what the server sends during the kill window and confirm no third party receives
anything they could not already derive from legitimate game state.

Write tests for this specifically, including one that measures whether message timing or
message size alone leaks that a kill occurred elsewhere on the map. A test that only
checks "the kill event isn't in the payload" is not sufficient.
```

## 7.10 — Ejection cutscene
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 10.2.

Implement the ejection sequence, roughly 3.5s: the pier, the walk into the fog, the
shrinking lantern, the light going out, one bell toll, then the reveal text.

There is no pier backdrop asset yet. Build the sequence with a placeholder and make the
backdrop swappable via a single asset key, so real art drops in later without touching
the timeline.

The reveal line must respect the existing "show ejected player's faction" lobby setting.
When it's off, omit the second line entirely — and make sure there is no timing difference
that betrays what it would have said. Same total duration either way.

Add a skip on any input after 1.5s. Skipping is per-client: one player skipping must not
affect what anyone else sees.
```

## 7.11 — Meeting call cutscene
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 10.3.

Implement the meeting call, roughly 1.8s: a ring of every player's lantern flaring to full
brightness against black, bell toll, title slam, then the discussion UI sliding up from
below.

Two variants sharing one timeline:
- body reported — header names the room where the body was found
- emergency button — header names the caller

The transition into the discussion UI must be continuous. No flash of unstyled content, no
gap, no jump cut.
```

### Playtest checkpoint

Before starting Block D, play a full round with friends.

If the game doesn't feel dramatically better than it did at the start of Phase 7, something
in Blocks A–C was skipped or done shallowly. Find it now. Blocks D, E, and F are the large
ones, and building them on a weak foundation multiplies the problem rather than hiding it.

---

# Block D — Interface

## 7.12 — Component kit
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 8, and docs/TOKEN_DEBT.md.

Build Panel, Button, Card, and Slider as the only styled primitives in the client.

The Button's 5px ink thickness bar and its 60ms press collapse are what make it feel like a
game button rather than a web button. Implement them exactly as specified.

Then rebuild every existing screen out of these four primitives, deleting one-off styling as
you go. TOKEN_DEBT.md is the worklist — this is where the colour repaint that 7.1
deliberately deferred finally happens. Work through it and check items off.

Enforce a 48px minimum interactive height everywhere. Fix anything with text below 13px.

As the final step of this task, flip the ESLint hex-literal rule from "warn" to "error". If
that can't be done because literals remain, list what's left and why.
```

## 7.13 — Lobby as a playable room
**Model:** Fable 5

```
Read docs/ART_BIBLE.md sections 5.2 and 8.

The lobby is currently an HTML form. Replace it with a walkable space — this is the single
largest experiential gap against Among Us and Goose Goose Duck.

The lobby is the Tavern interior. Players spawn as their Havener and can walk around and
see each other before the round starts. The host has a voteGold crown above their nameplate.

Ready state is physical: stand on a marked flagstone by the door. A green check appears
above ready players. The host's Start button unlocks when the minimum is met.

The settings panel becomes an overlay opened from a table in the room, not the primary
interface. Room code and invite buttons stay pinned as a small persistent HUD element.

CRITICAL: preserve every existing lobby feature — room code, invite link, friend invites,
role toggles, balance sliders, presets, language selector. This is a presentation change,
not a feature removal. Before finishing, enumerate every feature the old lobby had and
confirm each one still works. Report that list.

Room art doesn't exist yet. Use flat token-coloured shapes for the tavern; the art pass is
a later block.
```

## 7.14 — Role selection screen
**Model:** Opus 4.8

```
New mechanic, adapted from Goose Goose Duck.

After faction assignment but before the round starts, each player is offered a choice of
roles from within their own faction.

Flow: players are prompted in randomised order. Each is offered 3 role cards plus a Random
card, each with its emblem and a one-line description. A timer runs; on expiry, Random is
taken. Other players see only that someone is picking, and who has finished — never what
was offered or what was chosen.

Cards use the 7.12 Card primitive with the voteGold selected state. Role emblems exist as a
sheet in art/approved/ — if they haven't been sliced into individual assets yet, use
placeholders keyed so the real emblems drop in later.

SECURITY IS THE WHOLE POINT OF THIS PROMPT. The set of roles offered to a player leaks
faction information if any part of it is visible to others. The server sends each client
only its own options.

Test that a modified client cannot learn another player's offered set, their choice, their
faction, or even the size of their option list. Test that pick timing does not correlate
with faction — if Strangers get fewer options and therefore pick faster, that's a leak.

Add a lobby setting to disable role selection entirely and fall back to the current random
assignment.
```

## 7.15 — Discussion and voting screen
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 8.

Replace the text list with a grid of player Cards. Each card shows the player's Havener
sprite in their lantern colour, their name, their vote pips, and a speaking indicator driven
by the existing proximity voice system.

- Dead players: desaturated, ink X overlay, cannot be voted for
- Header: the meeting cause — the room where the body was found, or the caller's name
- A voteGold timer bar across the top
- SKIP is a first-class Button, not a small link

Voting: the card punches on selection, a pip drops in with a bounce. If the lobby is set to
anonymous voting, votes stay hidden until the timer ends — verify nothing in the network
traffic reveals them early.

The screen has to be readable at a glance during a 45-second timer. If it takes more than
about two seconds to find a specific player, the layout is wrong.
```

## 7.16 — Round end screen
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md sections 9 and 10.

Rebuild the round end screen on the cutscene language. The losing side's lanterns extinguish
one by one, 80ms apart, before the result title slams in.

Then the roster with each player's role emblem and faction, followed by the round summary and
voting history — all in Cards, collapsible so the screen isn't a wall of data on first view.
The drama comes first, the statistics come second.

Keep the report button on each player row and the return-to-lobby flow exactly as they work
now.
```

---

# Block E — World

The largest block. Do not start before Blocks A–C are done and the playtest checkpoint has
passed.

## 7.17 — Fog and lighting rework
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 6.

Replace the single radial gradient with three cooperating systems:

1. Three parallax noise fog layers per section 6.1. The near layer renders ABOVE characters —
   that one detail is what makes it read as weather rather than a filter.
2. A darkness mask with short 24px falloff, punched through by light sources. Radii from
   section 6.2. The sabotage transition animates over 1.2s, never instantly.
3. The Lighthouse Beam from section 6.3 — a rotating wedge, one sweep every 40s, briefly
   revealing whatever it crosses, visible to everyone.

The beam is server-driven with a deterministic phase seeded per round, so every client sees
it in the same place at the same time. It is a real gameplay element, not decoration: being
caught by it standing over a body must be a genuine risk.

Profile on mobile. If three fog layers are too expensive, drop the FAR layer on low-end
devices — never the near one, since that's the layer doing the actual work.
```

## 7.18 — Room art pass
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 5.

Work through the section 5.2 room table ONE ROOM AT A TIME, one commit per room. Do not
batch — if the style drifts, we need to see exactly where.

For each room:
1. Reshape its collision geometry to the assigned non-rectangular silhouette
2. Apply its palette skew
3. Hand-place 4-8 props
4. Place its in-world light source and wire it to the lighting system
5. Delete the in-world room name text — names live only on the minimap and in meeting
   headers from now on

Room art assets don't exist yet and will be generated separately as we go. For each room,
list exactly which prop and background assets you need, and the size each should be, so they
can be generated to spec rather than generated and then fudged to fit.
```

## 7.19 — Map graph audit
**Model:** Opus 4.8

```
Read docs/ART_BIBLE.md section 5.3. This task is independent of art.

FIRST, produce a written report. Change nothing until it's approved:
- every room with only one connection
- every room pair with only one route between them
- every sightline longer than 1.5 screen widths
- the vent/shortcut graph mapped against the walking graph, flagging where they trivially
  coincide and therefore add nothing

Then propose changes with reasoning and wait for approval. Do not silently redesign the map —
layout changes alter game balance in ways that aren't visible in code review.

Once approved and applied, add an automated test that fails if any room has fewer than two
connections, so future map edits can't reintroduce a dead end.
```

---

# Block F — Tasks

## 7.20 — Task minigame framework
**Model:** Fable 5

```
Tasks are currently "walk to a place". They need to be interactive minigames.

Build a framework where each minigame is a self-contained module declaring: its id, its
display name, its duration band (short/long), whether it is a VISUAL task (see 7.22), and a
mount/unmount lifecycle against a standard overlay built from the 7.12 primitives.

THE SERVER OWNS COMPLETION. The client reports an attempt; the server validates plausibility
— elapsed time within expected bounds, correct station, player alive and in range, task not
already complete, no impossible completion rate — and only then increments progress. Assume
the client is hostile and will try to complete every task instantly and remotely.

Deliver the framework plus one reference minigame, and tests covering every rejection path,
not just the happy path.
```

## 7.21 — First six minigames
**Model:** Sonnet 5

```
Build six minigames on the 7.20 framework, all built from the 7.12 primitives:

1. Trim the Wick — rotate a dial to bring a flame to the right height (short)
2. Mend the Net — drag rope ends to matching knots (long)
3. Wind the Lighthouse Gear — a rhythm hold, release at the right moment (short)
4. Pump the Bilge — repeated timed presses against a rising water line (long)
5. Sort the Ledger — drag entries into the correct column (long)
6. Ring the Bell — repeat a 4-note pattern back (short)

Each needs its own success and failure feel. Each must be completable in under 12 seconds by
someone who knows it — anything longer and players stop doing tasks, which breaks the entire
game loop.

Test each one on a phone. Drag-based minigames in particular tend to work on desktop and fall
apart on touch.
```

## 7.22 — Visual tasks
**Model:** Opus 4.8

```
The highest-value deduction mechanic in Among Us and Goose Goose Duck, and currently absent
from Foghaven. Completing one of these in front of a witness proves you are not a Stranger.

Implement three tasks that produce an effect other players can see:
1. Light the Beacon — the room floods with warm light for 3s, visible from adjacent rooms
2. Raise the Flag — a mast flag rises, visible across the harbour
3. Sound the Foghorn — a directional sound and visual pulse across the whole map

STRANGERS MUST BE UNABLE TO FAKE THESE. A Stranger at the station goes through the motions
with no visible effect. Verify at the server: only a genuine completion by a Townsfolk
broadcasts the effect, and the broadcast cannot be forged, replayed, or triggered by any
client-side means. Test the forge and replay paths explicitly.

Add a lobby setting to disable visual tasks, since they shift balance meaningfully toward the
Town.
```

---

# Block G — Audio

Both prompts here need assets sourced first — four ambience stems and seventeen stingers.
Don't start until those files exist in `client/public/audio/`.

**Note on tone:** ART_BIBLE section 1 says "cozy dread" — friendly shapes, unsettling world.
The audio must match. The reference is Over the Garden Wall, not Silent Hill: melancholy and
eerie folk, not horror. Warm low strings, distant accordion, nostalgic and gently unsettling.
If a stem sounds like a horror film, it's wrong for this game.

## 7.23 — Layered ambience system
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md section 11.

Build an AudioDirector managing four independent ambience layers (bed, sea, town, dread),
each a separately looping stem with its own gain node on a shared AudioContext. Stems load
from client/public/audio/ambience/.

If a stem file is missing, that layer stays silent and logs once. A missing file must never
throw or break the rest of the audio.

The director subscribes to game state and crossfades layer gains per the section 11.2 mix
table, over 2-3 seconds. It must never hard-cut — including on round start, round end, and
returning to lobby. Indoor rooms apply a low-pass filter to the town layer.

No melodic content anywhere. If a stem has a discernible tune, it's the wrong stem — say so
rather than shipping it.

Add a master volume plus independent music / SFX / voice sliders, persisted to localStorage.
The voice slider must actually apply to the WebRTC proximity voice gain, not just to SFX.

Add a dev-only debug panel showing the four live layer gains, so the mix can be tuned by ear
without a rebuild.
```

## 7.24 — Stinger library and mix ducking
**Model:** Sonnet 5

```
Read docs/ART_BIBLE.md sections 11.3 and 11.4.

Implement the 17-stinger library as a preloaded sprite sheet behind a single playStinger(key)
API. Every playback applies ±4% random pitch variation so repeats don't grate.

Automatic ducking:
- ambience drops to 15% during meetings
- ambience ducks under proximity voice whenever a nearby peer is transmitting

Own footsteps only, and quiet. NO footstep audio for other players — it leaks positional
information that the fog exists to hide. Add a test asserting that no remote player's position
or movement can trigger a local sound.
```

---

# Block H — Final

## 7.25 — Anti-leak sweep
**Model:** Opus 4.8

```
Final security pass over everything Phase 7 added. Art and animation are a new and easy leak
surface, and most of it was added by prompts focused on how things look rather than on what
they reveal.

Write the tests FIRST, then fix what they catch:

- No animation state, cosmetic, or lantern behaviour differs by faction in any way visible to
  another client
- Role emblems are never sent to clients that shouldn't have them
- Cutscene triggers are not inferable from message timing, size, or ordering
- The lighthouse beam reveals identically for everyone and cannot be locally disabled or
  delayed for advantage
- Fog and vision radii are enforced server-side; a client that draws less fog than it should
  simply doesn't receive the data it would need to cheat
- Reduced-motion and every accessibility setting confer no informational or timing advantage
- The role selection screen (7.14) and visual tasks (7.22) hold up under a client that logs
  all traffic

Finish with a written summary of what was tested, what was found, and what was fixed.
```

---

## Pacing

| Block | Prompts | Effort | Feel gained |
|---|---|---|---|
| A — Foundations | 7.3–7.4 | 1–2 evenings | none directly |
| B — Character | 7.5–7.7 | 4–5 evenings | large |
| C — Feel | 7.8–7.11 | 4–6 evenings | **largest per hour** |
| D — Interface | 7.12–7.16 | 6–8 evenings | large |
| E — World | 7.17–7.19 | 8–12 evenings | large |
| F — Tasks | 7.20–7.22 | 6–8 evenings | deepens the game most |
| G — Audio | 7.23–7.24 | 1–2 evenings + sourcing | large |
| H — Final | 7.25 | 1–2 evenings | none directly |

Two to three months of evenings, realistically. Block C is where it stops feeling like a
prototype.

---

## Deferred / tracked separately

Not part of Phase 7, but don't lose them:

- **Turkish legal copy.** `legal.privacy.body` and `legal.terms.body` have no Turkish
  translation. The game is live and most players are Turkish. Needs a real translation, not
  a machine one.
- **Test suite runtime.** 451 tests take ~17 minutes, which suggests real-time waits rather
  than fake timers. Not worth refactoring mid-Phase-7, but it will get painful.
- **`--ink-well`** is referenced but never defined, so its fallback always renders. Tracked
  in TOKEN_DEBT.md.

- **MAX_PLAYERS vs lantern colour count.** Server allows up to 15 players; ART_BIBLE §3.5
  defines exactly 14 lantern colours. A collision at max capacity already exists in the
  legacy 10-colour system today, independent of Phase 7. Decision needed before 7.7:
  either cap MAX_PLAYERS to 14 (recommended — trivial change, avoids adding a 15th colour
  too close to existing ones) or design a 15th lantern colour.
- **Preview/in-world visual unification.** The character now renders differently in-game
  (new Havener rig) versus in Inventory/Profile/GameOver previews (old archetype rig).
  Intentional for now, but needs a unification pass eventually.