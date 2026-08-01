import { useTranslation } from "react-i18next";
import {
  FACTION,
  roleById,
  strangerFactionCount,
  type RoleAssignment,
} from "@foghaven/shared";
import { Panel } from "./primitives";

interface RoleRevealProps {
  assignment: RoleAssignment | null;
  playerCount: number;
  /** The lobby's enabled role set (public state) — what the tally is computed from. */
  enabledRoleIds: string[];
  /** The host's `strangerCount` balance setting — 0 means "Auto" (the default threshold table). */
  strangerCountOverride: number;
}

/**
 * Shows the player the one role the server told them about, entirely
 * registry-driven: the name and hint come from `roleInfo.<id>` i18n keys and
 * the styling from the role's faction, so a new role needs strings, not
 * code. The stranger *count* is recomputed locally from the roster size, the
 * public role settings, and the public `strangerCount` balance setting
 * (`strangerCountOverride`) — all public rules, so displaying the tally
 * gives nothing away about who drew what.
 */
export function RoleReveal({
  assignment,
  playerCount,
  enabledRoleIds,
  strangerCountOverride,
}: RoleRevealProps) {
  const { t } = useTranslation();

  if (!assignment) {
    return (
      <Panel className="panel">
        <p className="hint">{t("roleReveal.waiting")}</p>
      </Panel>
    );
  }

  const definition = roleById(assignment.role);
  const isStrangerFaction = definition?.faction === FACTION.STRANGER;
  const fellows = assignment.fellows;

  return (
    <Panel
      className={`panel reveal ${isStrangerFaction ? "reveal-stranger" : "reveal-townsfolk"}`}
    >
      <p className="reveal-intro">{t("roleReveal.intro")}</p>
      <h1 className="reveal-role">{t(`roleInfo.${assignment.role}.reveal`)}</h1>

      <p className="hint">{t(`roleInfo.${assignment.role}.hint`)}</p>

      {definition?.revealsFellows &&
        (fellows.length > 0 ? (
          <div className="reveal-fellows">
            <p className="hint">{t("roleReveal.fellowStrangers")}</p>
            <ul className="roster">
              {fellows.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="hint">{t("roleReveal.soloStranger")}</p>
        ))}

      <p className="hint">
        {t("roleReveal.strangerTally", {
          count: strangerFactionCount(
            playerCount,
            enabledRoleIds,
            strangerCountOverride > 0 ? { stranger: strangerCountOverride } : {},
          ),
          total: playerCount,
        })}
      </p>
    </Panel>
  );
}
