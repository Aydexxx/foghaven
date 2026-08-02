# Foghaven — Phase 8: Identity

> The phase that answers "why would I play this instead of Among Us or Goose Goose Duck?"
> 11 prompts across 5 blocks. Same format as Phase 7 — paste the prompt, then the Standard Footer.

Repo: `C:\dev\foghaven` — worked across two machines (AYDENİZ, BROTHERS).
Companion docs: `docs/ART_BIBLE.md`, `docs/ROADMAP_PHASE7.md`.

---

## Why this phase exists

Phase 7 rebuilt how the game **looks**. Everything in it was correct work, but every single task was of the form "the reference games have this, let's have it too." Nothing in Phase 7 was an answer to why anyone would choose Foghaven over the games it was imitating.

Two observations drove this phase:

**From Among Us / Goose Goose Duck:** tasks are filler. They exist to fill a progress bar and give the impostor a reason to move around. Nobody has ever said "that task was intense."

**From Machine Party** (Klubnika/GDeavid, July 2026, ~89% positive in its first week, built by two people): the entire hook is that failing a minigame kills you. The developers deliberately stripped out dialogue, transitions, and board-game pacing — their stated design goal was *cut everything that isn't survival*. Its art is not technically impressive; it is **owned**. You can identify a screenshot instantly.

Foghaven's theme was already sitting on the answer and not using it: this is a **dangerous fishing harbour at night**. Winding a lighthouse gear, pumping a bilge, working a crane, mending nets in the dark — these are jobs that kill real people.

**So: the tasks become the danger.**

The consequence is the mechanic no competitor has. When you find a body, the first question stops being *"who killed them?"* and becomes **"was this murder, or did they just die?"** That ambiguity is Foghaven's identity, and it is only possible because tasks can kill.

## Design pillars

1. **Tasks carry risk.** Failure injures. Bad failure kills.
2. **The Stranger doesn't need to be there.** Sabotaged stations kill people while the Stranger is across the map with an alibi.
3. **Killing is a hunt, not a button.** The victim gets seconds, and a chance to scream.
4. **Pressure rises.** Lantern oil burns down. Fog thickens. The endgame is played nearly blind.
5. **Tuned for 4–8 players.** 14 still works technically, but every balance decision optimises for a small group where every player matters.

## What this replaces

**Phase 8 absorbs Phase 7 Block F entirely** (7.20 task framework, 7.21 minigames, 7.22 visual tasks). Do not run those — they are superseded here. Building a plain task system and then retrofitting risk onto it means writing it twice.

## Order relative to Phase 7

1. Bug-fix pass — in progress
2. **Phase 8** (this document)
3. Phase 7 Block E — world art (7.17, 7.18, 7.19), deliberately after Phase 8 so rooms are designed around mechanics that exist
4. Phase 7 Block G — audio (7.23, 7.24)
5. Phase 7 7.25 — anti-leak sweep, last

---

## Standard Footer

Paste after **every** prompt below.

```
Before finishing:
- Run `npm test` from the REPO ROOT, not from client/ or server/. Report the total
  test count. It must be 633 or higher. Running vitest from a subdirectory only runs
  that workspace's tests and reports a falsely small number.
- Run typecheck, eslint, and a production build. All must be clean.
- Commit with a descriptive message. Do not push.
- Stay strictly inside this task's scope. If you find something broken that is out of
  scope, report it at the end rather than fixing it.
- If a decision in this prompt seems wrong once you're in the code, stop and tell me
  rather than working around it silently.
- The client is untrusted. Any new state that affects the game must be
  server-authoritative, and no new field may leak faction, role, or hidden position.
```

## Model routing

| Model | Prompts |
|---|---|
| Fable 5 | 8.1, 8.2, 8.9 — systemic architecture |
| Opus 4.8 | 8.6, 8.7, 8.10 — game state, secrecy, balance |
| Sonnet 5 | everything else |

---

# Block A — Risk Foundation

Nothing else in this phase works until these two land. 8.1 in particular changes the game's death model, which touches win conditions, bodies, meetings, and ghosts.

## 8.1 — Injury and the new death model
**Model:** Fable 5
**Present a plan and wait for approval before implementing.** This changes core game state.

```
Read docs/ROADMAP_PHASE8.md's "Why this phase exists" and "Design pillars" sections first.

Today a player is alive or dead, and only a Stranger can cause death. Phase 8 introduces
a third state and a second cause.

FIRST: present your plan and wait for approval. Cover how condition interacts with the
existing alive flag, win conditions, body reporting, meetings, ghosts, the Doctor role,
and round reset. Flag anything that breaks.

Then implement a server-authoritative `condition` on Player:
- healthy — normal
- injured — movement speed reduced ~25%, lantern flickers visibly, task minigames get a
  small handicap (slower timer or narrower success window, per-minigame)
- dead

Rules:
- Injury is PUBLIC. Other players can see someone is injured (flickering lantern, altered
  gait). This is deliberate — "why are you limping?" is a social question and injury
  becoming information is the point. Do not hide it.
- An injured player who is injured again dies.
- A death caused by a task is a normal corpse: reportable, triggers meetings, counts
  toward win conditions. Nothing in the corpse or the report distinguishes accident from
  murder. That ambiguity IS the feature — verify no field, timing difference, packet
  size, or animation reveals the cause of death to anyone. Test this the same way the
  7.9 kill-secrecy tests do.
- The Doctor can heal injured → healthy. Reuse the existing ability system.
- Ghosts work exactly as they do now regardless of how the player died.

Do NOT wire any actual injury source yet — no task can hurt anyone until 8.2. This task
is purely the state machine, its network representation, and its consequences.
```

## 8.2 — Risky task framework
**Model:** Fable 5

```
Build the task minigame framework. This supersedes Phase 7's 7.20 — do not implement
that separately.

Each minigame is a self-contained module declaring: id, display name, duration band
(short/long), risk tier (safe / injury / lethal), whether it is a WITNESS task (see 8.5),
whether it is a DARK task (see 8.4), and a mount/unmount lifecycle against a standard
overlay built from the Phase 7 UI primitives.

THE SERVER OWNS BOTH COMPLETION AND FAILURE. The client reports an attempt; the server
validates plausibility (elapsed time within expected bounds, correct station, player
alive and in range, task not already complete, no impossible completion rate) and only
then applies the outcome. Assume the client is hostile and will try to:
- complete tasks instantly or remotely
- report success when it failed
- report failure when it succeeded (to fake an injury as an alibi)
- decline to report an outcome at all when the outcome would hurt it

That last case is the important one: a task that has started must resolve
server-side even if the client goes silent. Design for it explicitly.

Risk tiers:
- safe — failure just wastes time, retry allowed
- injury — failure injures (see 8.1)
- lethal — failure kills outright

Balance rule for this task: most tasks are `safe`. A handful are `injury`. Only one or
two are `lethal`, and a lethal task must telegraph its danger clearly before the player
commits — the player has to feel they chose the risk. Never a surprise death.

Deliver the framework plus one reference minigame at each risk tier, and tests covering
every rejection path and every hostile-client case above, not just the happy path.
```

---

# Block B — The Tasks

## 8.3 — Six harbour minigames
**Model:** Sonnet 5

```
Build six minigames on the 8.2 framework, all from the Phase 7 UI primitives. Each must
be completable in under 12 seconds by someone who knows it — longer and players stop
doing tasks, which breaks the game loop.

1. Trim the Wick (short, safe) — rotate a dial to bring a flame to the right height.
   Overshoot just resets.
2. Mend the Net (long, safe) — drag rope ends to matching knots.
3. Wind the Lighthouse Gear (short, INJURY) — hold to wind a spring, release in a narrow
   window. Release late and the crank kicks back. Show the danger zone on the gauge
   before they start.
4. Pump the Bilge (long, safe) — timed presses against a rising water line.
5. Sort the Ledger (long, safe) — drag entries into the correct column.
6. Haul the Crane (short, LETHAL) — balance a swinging load across a beam. Drop it on
   yourself and you die. This one must look dangerous before the player commits: a
   visible warning on the station, a confirm step, and unmistakable framing.

Each needs its own success and failure feel, routed through the existing JuiceDirector.
Failure should be dramatic — this is the moment the game earns its identity.

Test each on a phone. Drag-based minigames tend to work on desktop and fall apart on
touch.
```

## 8.4 — Dark tasks
**Model:** Sonnet 5

```
Some tasks require the player to extinguish their lantern first — the station won't
start while you're holding a light.

Implement three:
1. Develop the Plate — a darkroom photograph task; the image only appears in darkness
2. Read the Phosphor Chart — glowing markings only legible with no lantern
3. Set the Signal Mirror — align a reflection using only the lighthouse beam's sweep

Rules:
- Uses the existing extinguish mechanic. While extinguished the player's own vision is
  already sharply reduced and they are much harder for others to see — both halves stay
  in force during the task. This is voluntary vulnerability and must feel like it.
- Relighting mid-task cancels the task.
- Server-authoritative: verify the lantern was actually extinguished server-side for the
  whole duration. A client claiming darkness while lit must be rejected.

These are `safe` tier — the risk is being alone in the dark, not the task itself.
```

## 8.5 — Witness tasks
**Model:** Sonnet 5

```
Supersedes Phase 7's 7.22. Tasks that produce an effect other players can see, so
completing one in front of a witness proves you are not a Stranger.

1. Light the Beacon — the room floods with warm light for 3s, visible from adjacent rooms
2. Raise the Flag — a mast flag rises, visible across the harbour
3. Sound the Foghorn — a directional pulse across the whole map

STRANGERS MUST BE UNABLE TO FAKE THESE. A Stranger at the station goes through the
motions with no visible effect. Verify server-side: only a genuine completion by a
Townsfolk broadcasts the effect, and the broadcast cannot be forged, replayed, or
triggered by any client-side means. Test the forge and replay paths explicitly.

New consideration for Phase 8: a witness task must also not be completable by a
player whose station has been sabotaged (8.7) in a way that would fake the effect.
Coordinate with 8.7 — if 8.7 isn't built yet, leave a documented hook.

Add a lobby setting to disable witness tasks, since they shift balance toward the Town.
```

---

# Block C — The Hunt

The two prompts that most change how the game feels to play.

## 8.6 — Stalk kill
**Model:** Opus 4.8

```
Replace the instant kill with a hunt. This is the signature mechanic of the game — spend
real time on it.

Sequence:
1. The Stranger triggers a kill on a target in range. The target's lantern is SNUFFED —
   their screen drops to near-black, only faint shapes.
2. A window opens (start at 3.5s, must be tunable from config). During it:
   - The victim can run. Escaping the Stranger's reach before the window closes means
     they survive but are INJURED (8.1).
   - The victim can scream. Use the existing WebRTC proximity voice: on scream, the
     victim's live mic is broadcast at boosted volume and extended radius to everyone
     nearby. For players not in voice chat, show a directional visual indicator — "a cry
     from the north" — so the mechanic works without a microphone.
   - The Stranger must stay close. Breaking off cancels the kill; the target survives
     injured and the Stranger's cooldown still burns.
3. If the window closes with the victim in reach, the kill lands and the Phase 7 kill
   cutscene plays as it does today.

SECURITY IS THE MAIN CONCERN. This window is a long-lived observable event, which is a
much larger leak surface than the old instant kill. Nobody outside the two participants
and legitimate scream-range witnesses may learn that a hunt is happening — not from
message content, timing, ordering, packet size, or the heartbeat field added in the
bug-fix pass. Audit all of it and write tests the way the 7.9 kill-secrecy suite does,
including a timing-channel test.

Also verify: a witness who hears the scream learns direction and rough distance, but NOT
identity — of either party. That's the intended information, no more.
```

## 8.7 — Station sabotage
**Model:** Opus 4.8

```
The mechanic that makes "murder or accident?" a real question.

A Stranger can rig a task station instead of using it. The station looks normal. The
next Townsfolk who uses it suffers the failure outcome of that station's risk tier —
injury, or death at a lethal station — regardless of how well they played.

The Stranger is not present when it happens, and has an alibi.

Rules:
- Rigging takes time and is interruptible; being seen doing it is the risk.
- A rigged station has a subtle tell — a detail a careful player can notice before
  committing. Decide what it is and make it consistent across stations. This is
  non-negotiable: without a tell, this mechanic is pure unfairness rather than tension.
  It must be genuinely noticeable but easy to miss when you're rushing.
- One rig at a time per Stranger, with a cooldown. Do not let the map become a minefield.
- The Lamplighter can inspect a station and detect a rig. Give the Town a counter.
- A rig persists until triggered or until a meeting ends.

SECURITY: the fact that a station is rigged, and by whom, must never reach any client
that hasn't legitimately observed it. The rigged-ness must not be inferable from patch
contents, sizes, or timing. When a victim triggers a rig, nothing in the resulting
death/injury may distinguish it from an ordinary task failure — that indistinguishability
is the entire point of the mechanic. Test it.

Add a lobby setting to disable sabotage.
```

---

# Block D — Pressure

## 8.8 — Lantern oil
**Model:** Sonnet 5

```
The lantern burns oil. This creates a constant low-grade time pressure that the game
currently has none of.

- Oil depletes while lit. A full lantern lasts roughly 60% of an average round — tune
  from config, and make that number easy to change because it will need tuning.
- Extinguishing the lantern stops consumption. This gives the extinguish mechanic a
  second reason to exist beyond hiding.
- Refill at oil stations placed around the map. Refilling takes a few seconds and roots
  you in place — a deliberate vulnerability window.
- Running dry means your lantern goes out and cannot be relit until you refill: full
  blindness, in a map where blindness is fatal.
- Low oil shows on your own HUD only. Other players see the same flicker they'd see from
  an injury — deliberately ambiguous, so "is that guy hurt or just low on oil?" is a real
  question.

Server-authoritative. The client renders oil level; it never computes it.
```

## 8.9 — Fog escalation
**Model:** Fable 5

```
The fog thickens as the round progresses, so the endgame is played nearly blind.

- Everyone's vision radius shrinks over the round on a server-driven curve. Start it
  gentle and make the final third dramatic.
- The curve is deterministic and identical for all clients, seeded per round, exactly
  like the lighthouse beam.
- Interacts with everything already built: the extinguished-lantern radius, the
  sabotage lights-out radius, and the Stranger's larger radius all scale with the same
  curve rather than being replaced by it.
- No UI timer for this. The player should feel the walls closing in without being told.
  The only signal is the world itself.

This depends on the fog/lighting system from Phase 7's 7.17, which has not been built
yet. If 7.17 isn't done when you reach this, implement the escalation curve against the
current fog implementation and leave a clear seam so 7.17 can adopt it rather than
fight it.

Profile on mobile — a shrinking mask must not become more expensive as it shrinks.
```

---

# Block E — Making It Actually Good

The mechanics above are hypotheses. This block is where they get proven or corrected.

## 8.10 — Balance pass and telemetry
**Model:** Opus 4.8

```
Phase 8 introduced several mechanics whose numbers were guessed. Make them measurable.

1. Log per-round outcomes server-side (local dev only, nothing shipped to a third party
   and no personally identifying data): round length, win side, deaths by cause
   (murdered / task failure / sabotage / ejected), injuries, tasks attempted vs
   completed vs failed per risk tier, hunts started vs escaped vs completed, sabotages
   placed vs triggered vs detected, average oil refills per player.

2. Build a simple local dev view that reads those logs and shows the distribution across
   many rounds.

3. Put every balance number in Phase 8 — injury speed penalty, hunt window, oil burn
   rate, fog curve, sabotage cooldown, per-minigame difficulty — into one config file
   with a comment on each explaining what raising or lowering it does to play.

The specific worry to watch for: accidental deaths reduce the Town's numbers and
therefore help the Stranger, which could make task risk feel unfair rather than tense.
The telemetry needs to make that visible. Report what the numbers say after a few
simulated rounds.
```

## 8.11 — Onboarding
**Model:** Sonnet 5

```
Phase 8 added mechanics no player has seen in another game: task failure can kill you,
stations can be rigged, kills are a survivable window, lanterns burn oil, the fog closes
in. A new player who learns these by dying will quit.

Build first-run teaching that does NOT involve a tutorial anyone has to sit through:
- A station shows its risk tier before you commit — clear iconography, no text wall.
- The first time a player encounters each new mechanic in a round, a single short
  contextual line appears. Once. Never again for that player.
- The round-end screen names causes of death plainly ("crushed by the crane", "cast into
  the fog", "found in the fish market"), so the group learns the vocabulary together.
- A short "How to survive Foghaven" panel in the menu, readable in under a minute.

All strings in en and tr, and the locale-parity CI check must pass.
```

---

## Deferred and open questions

Not blocking, but do not lose them:

- **Is task risk actually fun, or just frustrating?** This is the phase's central bet, and
  it cannot be answered by testing — only by playing with real people. If 8.10's numbers
  show accidental death dominating, the risk tiers get dialled down hard.
- **The rigged-station tell** (8.7) is the single most likely thing to be wrong on the
  first pass. Too subtle and the mechanic is unfair; too obvious and sabotage is useless.
  Expect to tune it twice.
- **Scream without a microphone.** The directional indicator is the fallback, but a group
  where nobody uses voice loses a lot of 8.6's drama. Worth watching in playtests.
- **Turkish legal copy** — `legal.privacy.body` and `legal.terms.body` still have no
  Turkish translation. The game is live and most players are Turkish.
- **Test suite runtime** — the server suite takes ~17-20 minutes because of real-time
  waits. Phase 8 adds more timed mechanics; this will get worse before it gets better.
