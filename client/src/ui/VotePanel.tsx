import { useTranslation } from "react-i18next";
import { SKIP_VOTE } from "@foghaven/shared";
import * as juiceEvents from "../juice/juiceEvents";

export interface Candidate {
  id: string;
  name: string;
  hasVoted: boolean;
}

interface VotePanelProps {
  candidates: Candidate[];
  /** Null until this client has voted; the id they picked afterwards. */
  myVote: string | null;
  /** False for ghosts, who watch the vote but take no part in it. */
  canVote: boolean;
  onVote: (targetId: string) => void;
}

/**
 * The ballot. Shows every living player plus a skip option, and a "voted"
 * marker against anyone who has cast a ballot — the marker is driven by the
 * public `hasVoted` flag, never by who they chose, which the server does not
 * broadcast while the ballot is open.
 */
export function VotePanel({ candidates, myVote, canVote, onVote }: VotePanelProps) {
  const { t } = useTranslation();
  const locked = myVote !== null;

  /**
   * §9 gives casting a vote its own, stronger punch than the generic button
   * press, so these opt out of the delegated handler (`data-no-juice`) and
   * fire the specific row here instead.
   *
   * It also has to happen on the click rather than on pointerdown: a punch is
   * an acknowledgement that the ballot was accepted, and these buttons are
   * disabled the instant a vote locks. Acknowledging on press would celebrate
   * taps that never became votes.
   */
  const castVote = (event: React.MouseEvent<HTMLButtonElement>, targetId: string) => {
    juiceEvents.voteCast(event.currentTarget);
    onVote(targetId);
  };

  return (
    <div className="vote-panel">
      <ul className="vote-list">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              className={`vote-option ${myVote === candidate.id ? "vote-option-chosen" : ""}`}
              onClick={(event) => castVote(event, candidate.id)}
              disabled={!canVote || locked}
              data-vote-target={candidate.id}
              data-no-juice
            >
              <span className="vote-name">{candidate.name}</span>
              {candidate.hasVoted && <span className="vote-marker">{t("vote.hasVoted")}</span>}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={`vote-option vote-skip ${myVote === SKIP_VOTE ? "vote-option-chosen" : ""}`}
            onClick={(event) => castVote(event, SKIP_VOTE)}
            disabled={!canVote || locked}
            data-vote-target={SKIP_VOTE}
            data-no-juice
          >
            <span className="vote-name">{t("vote.skip")}</span>
          </button>
        </li>
      </ul>

      {!canVote && <p className="hint">{t("vote.ghostCannotVote")}</p>}
      {canVote && locked && <p className="hint">{t("vote.locked")}</p>}
    </div>
  );
}
