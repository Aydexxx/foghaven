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
}
