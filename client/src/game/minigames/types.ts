/**
 * The contract every mini-game implements.
 *
 * A mini-game is a pure puzzle: it never talks to the network, never knows
 * what a task is worth, and never knows what failing costs. It reports what
 * the player did and `TaskAttemptOverlay` — the 8.2 framework — turns that
 * into an attempt the server adjudicates. Keeping the puzzle ignorant of the
 * stakes is what lets the same six components serve a safe station and a
 * lethal one without a single conditional inside them.
 */
export interface MinigameProps {
  /** The player genuinely solved it. */
  onComplete: () => void;
  /**
   * The player genuinely failed it — botched the timing, ran out of attempts,
   * dropped the load. **Distinct from `onCancel`**, and the distinction is the
   * whole of 8.2's risk model: a failure is an outcome the server will act on
   * (and at `injury`/`lethal` tier, act on painfully), while a cancel is the
   * player walking away from a station having done nothing.
   *
   * A puzzle with no way to lose (the untimed exact-match ones) simply never
   * calls this, which is correct — it makes them unfailable by construction
   * rather than by a tier setting.
   */
  onFail: () => void;
  /** The player backed out. Only honoured by the server for `safe` tasks. */
  onCancel: () => void;
  /**
   * §8.1's injury handicap: a multiplier a mini-game applies to whatever its
   * own timing window is — 1 when healthy, `INJURED_MINIGAME_HANDICAP` when
   * injured. Each puzzle decides what "its window" means, which is why this is
   * a plain number rather than a prescribed rule.
   *
   * Only the two puzzles that HAVE a window use it today, and that is
   * deliberate rather than unfinished: `CalibrationGame` narrows its success
   * zone and `PatternMemoryGame` shortens each flash. The other four (code
   * entry, ordering, rotation, wires) are untimed exact-match puzzles with
   * nothing to narrow — bolting a timer onto them to "be consistent" would
   * change what those tasks are rather than how hard they are while hurt.
   * A new mini-game with a window should use this; one without should ignore
   * it.
   *
   * Now that 8.2 stakes real outcomes on a mini-game, this is no longer a
   * free-floating difficulty knob: an injured player really is likelier to
   * fail, and at the crane that means likelier to die. Still client-side
   * (a hostile client can decline the handicap) — what it cannot decline is
   * the server's plausibility window and the consequence of the outcome it
   * reports. See `GameRoom.handleTaskResolve`.
   */
  handicap: number;
}
