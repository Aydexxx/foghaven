import { useTranslation } from "react-i18next";
import type { LanternState } from "@foghaven/shared";
import { HavenerPreview } from "./HavenerPreview";
import { Button, Card } from "./primitives";
import * as juiceEvents from "../juice/juiceEvents";

export interface PlayerVoteCardProps {
  name: string;
  lanternColor: string;
  lanternState: LanternState;
  /** Public `deadPlayerIds` membership — the one reliable liveness signal; see `MeetingScreen`'s own note on why a player's own stale `alive` field is never trusted here. */
  dead: boolean;
  /** Public `hasVoted` — that a ballot was cast, never for whom. */
  hasVoted: boolean;
  /** False while this player is inside their reconnection grace period. */
  connected: boolean;
  /** Driven by the proximity voice system's per-peer analyser — see `VoiceController`. */
  speaking: boolean;
  isSelf: boolean;
  /**
   * This card is the LOCAL viewer's own current pick. Never derived from any
   * public field — `myVote` lives only in `MeetingScreen`'s local state,
   * exactly the way an anonymous ballot has to: nobody else's client can
   * ever construct this prop as true for anyone but the voter's own view.
   */
  selectedByMe: boolean;
  /** Present only once the ballot has resolved — the public, aggregate tally. Absent (not zero) beforehand, so a card can't accidentally render "0" as if that were live information. */
  voteCount?: number;
  /** Attached to the tally only when the `votesArePublic` setting is on. */
  voterNames?: string;
  onSelect?: () => void;
  onMute?: () => void;
  onReport?: () => void;
}

/**
 * One player, as a Card (ART_BIBLE §8): their Havener in their own lantern
 * colour, their name, whatever vote information is currently safe to show,
 * and a speaking ring driven by the existing proximity voice system.
 *
 * "Currently safe" is load-bearing. `voteCount`/`voterNames` are only ever
 * passed once the ballot has resolved (`MeetingScreen` withholds them for
 * every earlier stage) — this component has no phase awareness of its own on
 * purpose, so it cannot possibly render a partial tally by mistake. The one
 * live-ballot cue it draws is `selectedByMe`, and that prop's own doc is why
 * it can never leak: it is local-only, never derived from anything public.
 */
export function PlayerVoteCard({
  name,
  lanternColor,
  lanternState,
  dead,
  hasVoted,
  connected,
  speaking,
  isSelf,
  selectedByMe,
  voteCount,
  voterNames,
  onSelect,
  onMute,
  onReport,
}: PlayerVoteCardProps) {
  const { t } = useTranslation();
  const clickable = Boolean(onSelect) && !dead;

  /**
   * §9's "Vote cast" row: the card punches on selection. Lives here rather
   * than in `MeetingScreen` because that is the one place that actually has
   * the clicked DOM node — `onSelect` itself stays a plain `() => void`, so
   * every caller (the ballot, Skip, anything else that ever targets a card)
   * gets the punch for free without threading a ref or an event through.
   */
  const handleActivate = (target: HTMLElement) => {
    juiceEvents.voteCast(target);
    onSelect?.();
  };

  return (
    <Card
      selected={selectedByMe}
      dead={dead}
      className={`player-vote-card${speaking ? " player-vote-card-speaking" : ""}${clickable ? " player-vote-card-clickable" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? selectedByMe : undefined}
      onClick={clickable ? (event) => handleActivate(event.currentTarget) : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleActivate(event.currentTarget);
              }
            }
          : undefined
      }
      data-player-card
    >
      <div className="player-vote-card-portrait">
        <HavenerPreview
          lanternColor={lanternColor}
          lanternLit={lanternState === "lit" || lanternState === "flickering"}
          size={64}
        />
      </div>

      <span className="player-vote-card-name">
        {isSelf ? t("meeting.cardSelfName", { name }) : name}
      </span>

      <div className="player-vote-card-status">
        {!connected && (
          <span className="player-vote-card-away" title={t("lobbyRoom.disconnectedTag")} />
        )}
        {hasVoted && <span className="player-vote-card-voted" title={t("vote.hasVoted")} />}
      </div>

      {/*
        The local "you picked this" pip — §9's "a pip drops in with a
        bounce" — distinct from the RESULTS pips below. It renders from
        `selectedByMe` alone, which is local-only state (see that prop's own
        doc), so it can never become a real-time tally: nobody else's card
        can ever show this pip, on anybody's screen, before resolution.
      */}
      {voteCount === undefined && selectedByMe && (
        <div className="player-vote-card-pips" aria-hidden="true">
          <span className="player-vote-card-pip" />
        </div>
      )}

      {voteCount !== undefined && (
        <div className="player-vote-card-pips" aria-label={t("meeting.voteCount", { count: voteCount })}>
          {Array.from({ length: voteCount }, (_, i) => (
            <span
              key={i}
              className="player-vote-card-pip"
              style={{ animationDelay: `${i * 60}ms` }}
              aria-hidden="true"
            />
          ))}
          {voteCount === 0 && (
            <span className="player-vote-card-pip-zero">{t("meeting.voteCount", { count: 0 })}</span>
          )}
        </div>
      )}
      {voterNames && <span className="player-vote-card-voters">{voterNames}</span>}

      {(onMute || onReport) && !dead && (
        <div className="player-vote-card-moderation">
          {onMute && (
            <Button
              className="moderation-button"
              title={t("moderation.voteMuteTitle")}
              aria-label={t("moderation.voteMuteLabel", { name })}
              onClick={(event) => {
                event.stopPropagation();
                onMute();
              }}
            >
              🔇
            </Button>
          )}
          {onReport && (
            <Button
              className="moderation-button"
              title={t("moderation.reportTitle")}
              aria-label={t("moderation.reportLabel", { name })}
              onClick={(event) => {
                event.stopPropagation();
                onReport();
              }}
            >
              ⚑
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
