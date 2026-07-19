import { useTranslation } from "react-i18next";
import { ROLES, strangerCount, type RoleAssignment } from "@foghaven/shared";

interface RoleRevealProps {
  assignment: RoleAssignment | null;
  playerCount: number;
}

/**
 * Shows the player the one role the server told them about. The stranger
 * *count* is recomputed locally from the roster size — that's a public rule,
 * so displaying it gives nothing away about who they are.
 */
export function RoleReveal({ assignment, playerCount }: RoleRevealProps) {
  const { t } = useTranslation();

  if (!assignment) {
    return (
      <div className="panel">
        <p className="hint">{t("roleReveal.waiting")}</p>
      </div>
    );
  }

  const isStranger = assignment.role === ROLES.STRANGER;
  const fellows = assignment.fellowStrangers;

  return (
    <div className={`panel reveal ${isStranger ? "reveal-stranger" : "reveal-townsfolk"}`}>
      <p className="reveal-intro">{t("roleReveal.intro")}</p>
      <h1 className="reveal-role">
        {isStranger ? t("roleReveal.stranger") : t("roleReveal.townsfolk")}
      </h1>

      <p className="hint">
        {isStranger ? t("roleReveal.strangerHint") : t("roleReveal.townsfolkHint")}
      </p>

      {isStranger &&
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
          count: strangerCount(playerCount),
          total: playerCount,
        })}
      </p>
    </div>
  );
}
