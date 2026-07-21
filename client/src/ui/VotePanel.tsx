import { useTranslation } from "react-i18next";
import { SKIP_VOTE } from "@foghaven/shared";

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

  return (
    <div className="vote-panel">
      <ul className="vote-list">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              className={`vote-option ${myVote === candidate.id ? "vote-option-chosen" : ""}`}
              onClick={() => onVote(candidate.id)}
              disabled={!canVote || locked}
              data-vote-target={candidate.id}
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
            onClick={() => onVote(SKIP_VOTE)}
            disabled={!canVote || locked}
            data-vote-target={SKIP_VOTE}
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
