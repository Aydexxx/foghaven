import { MEETING_STAGE } from "@foghaven/shared";
import { voteWeights, type Ability } from "./types";

/**
 * The alderman's double vote. No target — usable only once the ballot is
 * actually open, and only marks the actor's *next* tally as worth two
 * (`GameRoom.resolveVotes` reads this weight instead of assuming every
 * ballot counts as one). Whether they've cast a vote yet or ever do is not
 * this ability's concern; an armed-but-unused flag is simply harmless, and
 * the round store it lives in clears itself at the next meeting either way.
 *
 * Applies social pressure rather than producing information: the room
 * doesn't learn anything new, but the alderman's voice in the room just got
 * louder for one ballot.
 */
export const doubleVoteAbility: Ability = {
  id: "double_vote",
  execute(ctx) {
    if (ctx.meetingStage !== MEETING_STAGE.VOTING) {
      return false;
    }
    voteWeights(ctx.roundStore).set(ctx.actorId, 2);
    return true;
  },
};
