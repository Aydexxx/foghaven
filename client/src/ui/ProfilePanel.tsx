import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  BADGE_DEFINITIONS,
  EMPTY_PLAYER_STATS,
  EQUIP_FIELD_BY_TYPE,
  type EquippedCosmetics,
  type PlayerStats,
} from "@foghaven/shared";
import { fetchStats } from "../net/stats";
import { fetchInventory } from "../net/cosmetics";
import { AuthError, deleteAccount } from "../net/auth";
import { archetypeForColor } from "../game/characters/assign";
import { VICTORY_POSE_VISUALS } from "../game/characters/cosmeticVisuals";
import { RigPreview } from "./RigPreview";

interface ProfilePanelProps {
  token: string;
  /** Used only to pick a stable preview archetype, same reasoning as `InventoryPanel`. */
  username: string;
  onClose: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  /** The account was just deleted — the caller signs the player out. */
  onAccountDeleted: () => void;
}

/** `mm:ss`, or `h:mm:ss` past an hour — this is a lifetime total, so it can get long. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes.toString().padStart(hours > 0 ? 2 : 1, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The profile screen: lifetime stats, the account's currently equipped
 * cosmetics, derived badges, and — in a clearly separated "danger zone" —
 * the GDPR/KVKK account-deletion path. Reachable from the main menu.
 *
 * Stats and cosmetics are fetched from two separate endpoints rather than
 * one combined one, the same "don't merge distinct data" reasoning
 * `InventoryPanel` already applies to catalog vs. owned — `/stats` and
 * `/cosmetics` are unrelated services with independent providers, and
 * merging them here would just mean juggling two loading states, badly, on
 * one object instead of two.
 */
export function ProfilePanel({
  token,
  username,
  onClose,
  onOpenPrivacy,
  onOpenTerms,
  onAccountDeleted,
}: ProfilePanelProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats>(EMPTY_PLAYER_STATS);
  const [loadout, setLoadout] = useState<Partial<EquippedCosmetics>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([fetchStats(token), fetchInventory(token)])
      .then(([playerStats, inventory]) => {
        if (cancelled) {
          return;
        }
        setStats(playerStats);
        const equipped: Partial<EquippedCosmetics> = {};
        for (const item of inventory.owned) {
          if (item.equipped) {
            equipped[EQUIP_FIELD_BY_TYPE[item.type]] = item.id;
          }
        }
        setLoadout(equipped);
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("profile.loadError"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  const previewArchetype = archetypeForColor(username).id;

  const handleDelete = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      setDeleteBusy(true);
      setDeleteError(null);
      void deleteAccount(token, deletePassword)
        .then(() => onAccountDeleted())
        .catch((err) => {
          setDeleteError(
            err instanceof AuthError && err.code === "invalid_password"
              ? t("profile.deleteAccount.wrongPassword")
              : t("profile.deleteAccount.error"),
          );
          setDeleteBusy(false);
        });
    },
    [token, deletePassword, onAccountDeleted, t],
  );

  return (
    <div className="profile-overlay" role="dialog" aria-label={t("profile.heading")}>
      <div className="profile-panel">
        <div className="profile-header">
          <h2>{t("profile.heading")}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t("profile.closeButton")}
          </button>
        </div>

        {loading && <p className="hint">{t("profile.loading")}</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !error && (
          <>
            <div className="profile-preview">
              <RigPreview
                archetypeId={previewArchetype}
                hat={loadout.hatId || undefined}
                accessory={loadout.accessoryId || undefined}
                outfit={loadout.outfitId || undefined}
                pet={loadout.petId || undefined}
                pose={loadout.victoryPoseId ? VICTORY_POSE_VISUALS[loadout.victoryPoseId] : undefined}
                size={112}
              />
              <p className="profile-username">{username}</p>
            </div>

            <div className="profile-stats-grid">
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.gamesPlayed}</span>
                <span className="profile-stat-label">{t("profile.stats.gamesPlayed")}</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{Math.round(stats.winRate * 100)}%</span>
                <span className="profile-stat-label">{t("profile.stats.winRate")}</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.tasksCompleted}</span>
                <span className="profile-stat-label">{t("profile.stats.tasksCompleted")}</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{formatDuration(stats.averageSurvivalTimeMs)}</span>
                <span className="profile-stat-label">{t("profile.stats.avgSurvival")}</span>
              </div>
            </div>

            {stats.roleStats.length > 0 && (
              <div className="profile-section">
                <h3>{t("profile.roleStats.heading")}</h3>
                <ul className="profile-role-list">
                  {stats.roleStats.map((role) => (
                    <li key={role.role} className="profile-role-row">
                      <span className="profile-role-name">{t(`roleInfo.${role.role}.name`, role.role)}</span>
                      <span className="profile-role-record">
                        {t("profile.roleStats.record", {
                          wins: role.gamesWon,
                          games: role.gamesPlayed,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="profile-section">
              <h3>{t("profile.badges.heading")}</h3>
              <ul className="profile-badge-grid">
                {BADGE_DEFINITIONS.map((badge) => {
                  const earned = badge.isEarned(stats);
                  return (
                    <li
                      key={badge.id}
                      className={earned ? "profile-badge profile-badge-earned" : "profile-badge profile-badge-locked"}
                      title={t(`profile.badges.${badge.id}.description`)}
                    >
                      <span className="profile-badge-name">{t(`profile.badges.${badge.id}.name`)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="profile-legal-links">
              <button type="button" className="link-button" onClick={onOpenPrivacy}>
                {t("legal.privacy.title")}
              </button>
              <button type="button" className="link-button" onClick={onOpenTerms}>
                {t("legal.terms.title")}
              </button>
            </div>

            <div className="profile-danger-zone">
              <h3>{t("profile.deleteAccount.heading")}</h3>
              <p className="hint">{t("profile.deleteAccount.description")}</p>
              {!confirmingDelete ? (
                <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>
                  {t("profile.deleteAccount.startButton")}
                </button>
              ) : (
                <form onSubmit={handleDelete} className="profile-delete-form">
                  <label className="field">
                    <span>{t("profile.deleteAccount.passwordLabel")}</span>
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      autoComplete="current-password"
                      disabled={deleteBusy}
                      autoFocus
                    />
                  </label>
                  <div className="profile-delete-actions">
                    <button type="submit" className="danger" disabled={deleteBusy || !deletePassword}>
                      {deleteBusy ? t("profile.deleteAccount.busy") : t("profile.deleteAccount.confirmButton")}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={deleteBusy}
                      onClick={() => {
                        setConfirmingDelete(false);
                        setDeletePassword("");
                        setDeleteError(null);
                      }}
                    >
                      {t("profile.deleteAccount.cancelButton")}
                    </button>
                  </div>
                  {deleteError && <p className="error">{deleteError}</p>}
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
