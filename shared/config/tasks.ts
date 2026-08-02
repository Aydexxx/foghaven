import { TASK_ROOM_ANCHOR } from "../map/townMap";

/** The four task shapes used for assignment (who gets what, how many extras). */
export type TaskType = "short" | "long" | "common" | "visual";

/**
 * The six harbour mini-games (docs/ROADMAP_PHASE8.md 8.3) a task point can
 * present. This is a purely client-side rendering concern — the server never
 * looks at it; every step of a task re-plays the same mini-game, freshly
 * randomised each time. `wick` and `net` each cover two `TASK_DEFINITIONS`
 * entries — the same reuse the placeholder set this replaced already had.
 *
 *   - `wick`   — Trim the Wick: drag a flame's height into a band; overshoot resets it.
 *   - `net`    — Mend the Net: drag rope ends to their matching knots.
 *   - `gear`   — Wind the Lighthouse Gear: hold to wind, release in the
 *                window. The one INJURY-tier game — release late and the
 *                crank kicks back.
 *   - `bilge`  — Pump the Bilge: timed presses against a rising water line.
 *   - `ledger` — Sort the Ledger: drag entries into the correct column.
 *   - `crane`  — Haul the Crane: balance a swinging load across a beam. The
 *                one LETHAL-tier game — drop it on yourself and you die.
 */
export type MinigameType = "wick" | "net" | "gear" | "bilge" | "ledger" | "crane";

/**
 * A single stage of a task. Steps are placeholders for now — completing one
 * currently just means finishing the assigned mini-game once. Multi-step
 * ("long") tasks play the same mini-game again for each remaining step.
 */
export interface TaskStep {
  id: string;
}

/**
 * What failing this task costs (docs/ROADMAP_PHASE8.md, pillar 1: "Tasks carry
 * risk. Failure injures. Bad failure kills.").
 *
 *   - `safe` — failure wastes the attempt and nothing more. Retry freely.
 *   - `injury` — failure injures (see `PLAYER_CONDITION`); a second one kills.
 *   - `lethal` — failure kills outright.
 *
 * **Balance rule, deliberately encoded rather than left to taste:** most tasks
 * are safe, a handful injure, and only one or two in the whole game are
 * lethal. `TASK_TIER_BUDGET` below pins that, and a test enforces it, so
 * adding a third lethal task fails CI rather than quietly making the town
 * unplayable.
 *
 * Public knowledge, not a secret. Which station is dangerous is exactly the
 * kind of thing everyone in a harbour would know, and the player has to be
 * able to weigh the risk before committing — a tier nobody can see would make
 * every lethal task a surprise death, which the design forbids.
 */
export type RiskTier = "safe" | "injury" | "lethal";

/**
 * How long a task is expected to take. Drives the server's plausibility
 * window (`TASK_BAND_BOUNDS`) — not the client's puzzle, which is free to be
 * as quick as the player is good.
 */
export type DurationBand = "short" | "long";

/**
 * The window a task attempt must resolve inside, per band.
 *
 * `minMs` is the anti-instant-completion floor: an attempt that resolves
 * sooner than this did not happen, whatever the client claims. It is
 * deliberately well under how long the puzzle actually takes a competent
 * player (8.3 targets "under 12 seconds"), because this is a plausibility
 * bound, not a difficulty gate — the server cannot see the puzzle and must
 * not punish someone who is simply fast.
 *
 * `maxMs` is the deadline. It is not merely a validation ceiling: it is the
 * moment the SERVER resolves the attempt by itself, as a failure, whether or
 * not the client said anything. That is the whole answer to a client that
 * declines to report an outcome it doesn't like — see the
 * `this.clock.setTimeout(...)` armed inside `GameRoom.handleTaskStart`,
 * which calls `closeTaskAttempt` as a timeout the moment `maxMs` elapses.
 */
export const TASK_BAND_BOUNDS: Readonly<Record<DurationBand, { minMs: number; maxMs: number }>> = {
  short: { minMs: 1_200, maxMs: 20_000 },
  long: { minMs: 2_500, maxMs: 35_000 },
};

/**
 * The most tasks of each tier the game may define, enforced by test.
 *
 * "Most tasks are safe. A handful are injury. Only one or two are lethal."
 * Left as an assertion rather than a comment because tier creep is invisible
 * one task at a time and catastrophic in aggregate: a town that loses two
 * players an round to their own job list has no game left to play.
 */
export const TASK_TIER_BUDGET: Readonly<Record<RiskTier, number>> = {
  safe: Number.POSITIVE_INFINITY,
  injury: 3,
  lethal: 2,
};

/** A task's room, restricted to the rooms a task can actually sit in — not Town Hall (bell only) or the Streets (transit only). */
export type TaskRoomSlug = keyof typeof TASK_ROOM_ANCHOR;

/**
 * A task point on the map: where it is, what kind it is, how many stages it
 * has. `room` is the English slug the server and both clients agree on; the
 * display name is an i18n lookup (`rooms.<slug>`) done wherever this is
 * rendered, never stored here.
 */
export interface TaskDefinition {
  id: string;
  /** Assignment shape — who gets this and how many extras. Distinct from `band`. */
  type: TaskType;
  minigame: MinigameType;
  room: TaskRoomSlug;
  x: number;
  y: number;
  steps: TaskStep[];

  // --- The 8.2 module declaration -----------------------------------------
  //
  // Everything below is what makes a task a self-contained module rather than
  // a coordinate with a puzzle bolted on. All of it is SHARED because the
  // server needs every field: `band` bounds the plausibility window, `tier`
  // decides what a failure costs, and `witness`/`dark` gate effects it alone
  // is allowed to authorise.

  /** Expected length, which sets the server's plausibility window. */
  band: DurationBand;
  /** What failing costs. See `RiskTier`. */
  tier: RiskTier;
  /**
   * Produces an effect other players can see, proving the doer is not a
   * Stranger (8.5). Declared here now so the framework carries the flag from
   * the start; **nothing consumes it yet** — the broadcast, and the rule that
   * only a genuine Townsfolk completion may trigger it, land in 8.5.
   */
  witness: boolean;
  /**
   * Requires the player's lantern to be extinguished for the whole attempt
   * (8.4). Declared now, **not enforced yet**: the server-side "was it
   * actually dark the entire time" check is 8.4's job, and a half-enforced
   * version would be worse than none — a client could learn exactly how much
   * darkness it had to fake.
   */
  dark: boolean;
}

/** Distance, in world units, within which a player may interact with a task. */
export const TASK_INTERACT_RADIUS = 40;

/** Every "common" task is dealt to every player, plus this many random extras. */
export const RANDOM_TASKS_PER_PLAYER = 4;

/**
 * One task per room that can hold one, positioned at that room's interior
 * center (`TASK_ROOM_ANCHOR`, from the town map) rather than a hand-picked
 * number — so a task can never end up off the walkable grid by a stray
 * coordinate, and moving a room in the map moves its task with it for free.
 */
export const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  {
    id: "trim-the-wick",
    type: "short",
    minigame: "wick",
    room: "lampRoom",
    ...TASK_ROOM_ANCHOR.lampRoom,
    band: "short",
    tier: "safe",
    witness: false,
    dark: false,
    steps: [{ id: "1" }],
  },
  {
    id: "mend-the-net",
    type: "long",
    minigame: "net",
    room: "fishMarket",
    ...TASK_ROOM_ANCHOR.fishMarket,
    band: "long",
    tier: "safe",
    witness: false,
    dark: false,
    steps: [{ id: "1" }, { id: "2" }, { id: "3" }],
  },
  {
    // The one INJURY-tier task in the set — see `RiskTier`'s doc and
    // `TASK_TIER_BUDGET`. Lighthouse room, lighthouse gear: no reflavoring
    // needed, the theme was already right.
    id: "wind-the-lighthouse-gear",
    type: "short",
    minigame: "gear",
    room: "lighthouse",
    ...TASK_ROOM_ANCHOR.lighthouse,
    band: "short",
    tier: "injury",
    witness: false,
    dark: false,
    steps: [{ id: "1" }],
  },
  {
    id: "pump-the-bilge",
    type: "long",
    minigame: "bilge",
    room: "docks",
    ...TASK_ROOM_ANCHOR.docks,
    band: "long",
    tier: "safe",
    witness: false,
    dark: false,
    steps: [{ id: "1" }, { id: "2" }, { id: "3" }],
  },
  {
    id: "sort-the-ledger",
    // Kept "common" (dealt to every player) — the same administrative-errand
    // role `sign-the-ledger` had before this replaced it.
    type: "common",
    minigame: "ledger",
    room: "tavern",
    ...TASK_ROOM_ANCHOR.tavern,
    band: "long",
    tier: "safe",
    witness: false,
    dark: false,
    steps: [{ id: "1" }, { id: "2" }, { id: "3" }],
  },
  {
    // The one LETHAL-tier task in the set — see `RiskTier`'s doc and
    // `TASK_TIER_BUDGET`. Warehouse room, an actual crane: no reflavoring
    // needed here either.
    id: "haul-the-crane",
    type: "short",
    minigame: "crane",
    room: "warehouse",
    ...TASK_ROOM_ANCHOR.warehouse,
    band: "short",
    tier: "lethal",
    witness: false,
    dark: false,
    steps: [{ id: "1" }],
  },
  {
    // Not one of 8.3's six named tasks — the roadmap asks for six mini-games,
    // not eight, and `map.test.ts` pins one task per task-eligible room. This
    // reuses `wick`'s dial-drag mechanic (a chart reading is exactly the kind
    // of "get the needle in the band" fiddling the wick gauge already does),
    // the same way `calibration` used to cover two rooms.
    id: "read-the-chart",
    type: "visual",
    minigame: "wick",
    room: "infirmary",
    ...TASK_ROOM_ANCHOR.infirmary,
    band: "short",
    tier: "safe",
    witness: false,
    dark: false,
    steps: [{ id: "1" }],
  },
  {
    // As above — reuses `net`'s drag-to-match mechanic (matching manifest
    // entries by connecting them is mechanically the same shape as tying
    // ropes to knots).
    id: "decode-the-manifest",
    type: "long",
    minigame: "net",
    room: "cellar",
    ...TASK_ROOM_ANCHOR.cellar,
    band: "long",
    tier: "safe",
    witness: false,
    dark: false,
    steps: [{ id: "1" }, { id: "2" }],
  },
];

export const TASK_DEFINITIONS_BY_ID: ReadonlyMap<string, TaskDefinition> = new Map(
  TASK_DEFINITIONS.map((task) => [task.id, task]),
);

/**
 * The private, per-player view of one assigned task: definition data plus this
 * player's own progress. Sent to exactly one client — see `GameRoom.assignTasks`.
 * The shape is identical whether the underlying task is real or fake, which is
 * what makes a stranger's task list indistinguishable from a townsfolk's.
 */
export interface ClientTask {
  id: string;
  type: TaskType;
  minigame: MinigameType;
  room: TaskRoomSlug;
  x: number;
  y: number;
  totalSteps: number;
  completedSteps: number;
  /**
   * The module declaration, carried through so the client can telegraph the
   * risk BEFORE the player commits (a lethal station has to look lethal).
   *
   * Identical for a fake task, and that is load-bearing: if a Stranger's
   * fake copy of the crane declared a different tier — or if their failure
   * did not actually kill them — then surviving it would out them. See
   * `GameRoom.applyTaskOutcome`, where risk is applied from the definition
   * without ever consulting the actor's faction.
   */
  band: DurationBand;
  tier: RiskTier;
  witness: boolean;
  dark: boolean;
}

/** The initial private task list, sent once as gameplay begins. */
export interface TasksMessage {
  tasks: ClientTask[];
}

/** One step of progress on a single task, sent after every interaction. */
export interface TaskProgressMessage {
  taskId: string;
  completedSteps: number;
}

// --- The 8.2 attempt lifecycle ---------------------------------------------
//
// A task is no longer a single "I did it" message. It is an ATTEMPT the server
// opens, owns, and closes:
//
//   client  --task_start-->    server opens an attempt and arms a deadline
//   server  --taskStarted-->   client runs the puzzle
//   client  --task_resolve-->  server validates plausibility, applies outcome
//
// and, crucially, if that last message never arrives the server closes the
// attempt itself at the deadline — as a FAILURE. Every branch below exists
// because the client is assumed hostile; see `GameRoom.handleTaskStart`.

/** Why the server refused to open or resolve an attempt. Only ever about the asker's own state. */
export type TaskRejectReason =
  | "phase"
  | "not_assigned"
  | "already_complete"
  | "out_of_range"
  | "dead"
  | "busy"
  | "not_started"
  | "too_fast"
  | "unconfirmed";

/** `task_start` — request to open an attempt. */
export interface TaskStartMessage {
  taskId: string;
  /**
   * Explicit acknowledgement of a lethal task's danger. The server REFUSES to
   * open a lethal attempt without it, which is what turns "never a surprise
   * death" from a UI convention into a rule: a client that skips the warning
   * screen cannot start the task at all, so nobody can die at a station they
   * were never shown the danger of.
   */
  confirmed?: boolean;
}

/** `task_resolve` — the client reporting how its puzzle went. */
export interface TaskResolveMessage {
  taskId: string;
  success: boolean;
}

/** `task_abort` — the client backing out. Only honoured for `safe` tasks. */
export interface TaskAbortMessage {
  taskId: string;
}

/** Server accepted the attempt. `deadlineMs` is when it will resolve itself. */
export interface TaskStartedMessage {
  taskId: string;
  deadlineMs: number;
  tier: RiskTier;
}

/** Server refused. The client closes its overlay; nothing happened. */
export interface TaskRejectedMessage {
  taskId: string;
  reason: TaskRejectReason;
}

/**
 * How an attempt actually ended, as decided by the server. Sent to the actor
 * only — an outcome is private, even though an injury or a corpse resulting
 * from it is very much not.
 */
export interface TaskOutcomeMessage {
  taskId: string;
  success: boolean;
  tier: RiskTier;
  /** True when the server closed this itself at the deadline rather than being told. */
  timedOut: boolean;
}
