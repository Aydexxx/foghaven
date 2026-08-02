/**
 * The contract every mini-game implements. `onComplete` is called once the
 * player has genuinely solved the puzzle — the caller (`MinigameModal`) is
 * responsible for telling the server; a mini-game component never talks to
 * the network itself. `onCancel` lets the player back out (Escape or the
 * modal's close button) without completing anything.
 */
export interface MinigameProps {
  onComplete: () => void;
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
   * Difficulty only, and client-side only. Nothing is staked on a mini-game's
   * outcome until 8.2 gives the server authority over completion AND failure,
   * so a hostile client ignoring this currently gains nothing. Do not build a
   * mechanic on it before that lands — see `INJURED_MINIGAME_HANDICAP`.
   */
  handicap: number;
}
