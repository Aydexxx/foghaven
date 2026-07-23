import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { REPORT_STATUS, USER_ROLE, hasRole, type UserRole } from "@foghaven/shared";
import {
  AdminError,
  banUser,
  fetchChatLog,
  getUser,
  listReports,
  resolveReport,
  searchUsers,
  setUserRole,
  unbanUser,
  type AdminChatEntry,
  type AdminReport,
  type AdminUser,
  type BanHistoryEntry,
} from "../net/admin";

interface AdminPanelProps {
  token: string;
  /** The caller's role as the *server* reported it — see `fetchAdminIdentity`. */
  role: UserRole;
  onClose: () => void;
}

type Tab = "reports" | "users";

/**
 * The moderation panel: a report queue and a user lookup with ban controls.
 *
 * Deliberately plain. This is a tool for someone dealing with a live problem,
 * so everything is one click from the queue — read the report, see the chat
 * that came with it, ban or dismiss without leaving the row.
 *
 * Nothing here is a security boundary. The panel is only rendered when the
 * server has confirmed the caller's role (`/admin/me`), and every button below
 * hits a route that re-checks that role against the database — so a player who
 * forces this component open sees nothing but errors.
 */
export function AdminPanel({ token, role, onClose }: AdminPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("reports");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Report queue
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");

  // User lookup
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [banHistory, setBanHistory] = useState<BanHistoryEntry[]>([]);
  const [banReason, setBanReason] = useState("");
  const [banUntil, setBanUntil] = useState("");
  const [chatLog, setChatLog] = useState<AdminChatEntry[] | null>(null);

  const run = useCallback((action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void action()
      .catch((err) => setError(err instanceof AdminError ? err.code : "unknown"))
      .finally(() => setBusy(false));
  }, []);

  const refreshReports = useCallback(async () => {
    setReports(await listReports(token, showResolved ? null : REPORT_STATUS.OPEN));
  }, [token, showResolved]);

  useEffect(() => {
    run(refreshReports);
  }, [refreshReports, run]);

  const openUser = (userId: string) => {
    run(async () => {
      const detail = await getUser(token, userId);
      setSelected(detail.user);
      setBanHistory(detail.banHistory);
      setBanReason("");
      setBanUntil("");
      setTab("users");
    });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      setUsers(await searchUsers(token, query.trim()));
      setSelected(null);
    });
  };

  return (
    <div className="admin-overlay" role="dialog" aria-label={t("admin.heading")}>
      <div className="admin-panel">
        <div className="admin-header">
          <h2>
            {t("admin.heading")} <span className="admin-role-tag">{t(`admin.roles.${role}`)}</span>
          </h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t("admin.closeButton")}
          </button>
        </div>

        <div className="admin-tabs">
          <button
            type="button"
            className={tab === "reports" ? "admin-tab admin-tab-active" : "admin-tab"}
            onClick={() => setTab("reports")}
          >
            {t("admin.tabs.reports", { count: reports.length })}
          </button>
          <button
            type="button"
            className={tab === "users" ? "admin-tab admin-tab-active" : "admin-tab"}
            onClick={() => setTab("users")}
          >
            {t("admin.tabs.users")}
          </button>
        </div>

        {tab === "reports" && (
          <>
            <label className="admin-filter">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(event) => setShowResolved(event.target.checked)}
              />
              <span>{t("admin.showResolved")}</span>
            </label>

            <ul className="admin-list">
              {reports.length === 0 && <li className="hint">{t("admin.noReports")}</li>}
              {reports.map((report) => (
                <li key={report.id} className="admin-report">
                  <div className="admin-report-head">
                    <span className="admin-report-target">{report.reportedName}</span>
                    <span className={`admin-reason admin-reason-${report.reason}`}>
                      {t(`report.reasons.${report.reason}`)}
                    </span>
                    <span className={`admin-status admin-status-${report.status}`}>
                      {t(`admin.status.${report.status}`)}
                    </span>
                  </div>
                  <p className="hint">
                    {t("admin.reportedBy", {
                      name: report.reporterName,
                      room: report.roomCode,
                      when: new Date(report.createdAt).toLocaleString(),
                    })}
                  </p>
                  {report.note && <p className="admin-report-note">“{report.note}”</p>}

                  <div className="admin-report-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setExpanded(expanded === report.id ? null : report.id)}
                    >
                      {t("admin.viewEvidence", { count: report.chatExcerpt.length })}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openUser(report.reportedId)}
                      disabled={busy}
                    >
                      {t("admin.openUser")}
                    </button>
                  </div>

                  {expanded === report.id && (
                    <div className="admin-evidence">
                      {report.chatExcerpt.length === 0 && (
                        <p className="hint">{t("admin.noEvidence")}</p>
                      )}
                      {report.chatExcerpt.map((line, index) => (
                        <p key={index} className="admin-chat-line">
                          <span className="admin-chat-sender">{line.senderName}</span>
                          <span>{line.text}</span>
                        </p>
                      ))}

                      {report.status === REPORT_STATUS.OPEN && (
                        <div className="admin-resolve">
                          <input
                            type="text"
                            value={resolution}
                            placeholder={t("admin.resolutionPlaceholder")}
                            onChange={(event) => setResolution(event.target.value)}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await resolveReport(
                                  token,
                                  report.id,
                                  REPORT_STATUS.ACTIONED,
                                  resolution,
                                );
                                setResolution("");
                                await refreshReports();
                              })
                            }
                          >
                            {t("admin.markActioned")}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await resolveReport(
                                  token,
                                  report.id,
                                  REPORT_STATUS.DISMISSED,
                                  resolution,
                                );
                                setResolution("");
                                await refreshReports();
                              })
                            }
                          >
                            {t("admin.dismiss")}
                          </button>
                        </div>
                      )}

                      {report.resolution && (
                        <p className="hint">{t("admin.resolvedNote", { note: report.resolution })}</p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "users" && (
          <>
            <form className="admin-search" onSubmit={search}>
              <input
                type="text"
                value={query}
                placeholder={t("admin.searchPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="submit" disabled={busy}>
                {t("admin.searchButton")}
              </button>
            </form>

            {!selected && (
              <ul className="admin-list">
                {users.length === 0 && <li className="hint">{t("admin.noUsers")}</li>}
                {users.map((user) => (
                  <li key={user.id} className="admin-user-row">
                    <span className="admin-user-name">{user.username}</span>
                    {user.banned && <span className="admin-banned-tag">{t("admin.bannedTag")}</span>}
                    {user.role !== USER_ROLE.PLAYER && (
                      <span className="admin-role-tag">{t(`admin.roles.${user.role}`)}</span>
                    )}
                    <span className="hint">{t("admin.reportCount", { count: user.reportsAgainst })}</span>
                    <button type="button" className="secondary" onClick={() => openUser(user.id)}>
                      {t("admin.openUser")}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected && (
              <div className="admin-user-detail">
                <button type="button" className="link-button" onClick={() => setSelected(null)}>
                  {t("admin.backToResults")}
                </button>

                <h3>{selected.username}</h3>
                <p className="hint">
                  {selected.email} · {t(`admin.roles.${selected.role}`)} ·{" "}
                  {t("admin.reportCount", { count: selected.reportsAgainst })}
                </p>

                {selected.banned ? (
                  <div className="admin-ban-state">
                    <p className="error">
                      {t("admin.currentlyBanned", {
                        reason: selected.banReason ?? "",
                        until: selected.banUntil
                          ? new Date(selected.banUntil).toLocaleString()
                          : t("admin.permanent"),
                      })}
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await unbanUser(token, selected.id);
                          openUser(selected.id);
                        })
                      }
                    >
                      {t("admin.unbanButton")}
                    </button>
                  </div>
                ) : (
                  <div className="admin-ban-form">
                    <label className="field">
                      <span>{t("admin.banReasonLabel")}</span>
                      <input
                        type="text"
                        value={banReason}
                        onChange={(event) => setBanReason(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>{t("admin.banUntilLabel")}</span>
                      <input
                        type="datetime-local"
                        value={banUntil}
                        onChange={(event) => setBanUntil(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="admin-ban-button"
                      disabled={busy || !banReason.trim()}
                      onClick={() =>
                        run(async () => {
                          await banUser(
                            token,
                            selected.id,
                            banReason.trim(),
                            // Empty means permanent; the server reads a missing
                            // `until` exactly that way.
                            banUntil ? new Date(banUntil).toISOString() : null,
                          );
                          openUser(selected.id);
                        })
                      }
                    >
                      {banUntil ? t("admin.banTemporaryButton") : t("admin.banPermanentButton")}
                    </button>
                  </div>
                )}

                {/* Only admins can move roles; moderators never see the control. */}
                {hasRole(role, USER_ROLE.ADMIN) && (
                  <div className="admin-role-form">
                    <span>{t("admin.roleLabel")}</span>
                    {([USER_ROLE.PLAYER, USER_ROLE.MODERATOR, USER_ROLE.ADMIN] as const).map(
                      (option) => (
                        <button
                          key={option}
                          type="button"
                          className={
                            selected.role === option ? "preset-button preset-button-active" : "preset-button"
                          }
                          disabled={busy || selected.role === option}
                          onClick={() =>
                            run(async () => {
                              await setUserRole(token, selected.id, option);
                              openUser(selected.id);
                            })
                          }
                        >
                          {t(`admin.roles.${option}`)}
                        </button>
                      ),
                    )}
                  </div>
                )}

                <h4>{t("admin.banHistoryHeading")}</h4>
                <ul className="admin-list admin-ban-history">
                  {banHistory.length === 0 && <li className="hint">{t("admin.noBanHistory")}</li>}
                  {banHistory.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.reason}</span>
                      <span className="hint">
                        {new Date(entry.createdAt).toLocaleDateString()}
                        {entry.until
                          ? ` → ${new Date(entry.until).toLocaleDateString()}`
                          : ` · ${t("admin.permanent")}`}
                        {entry.liftedAt ? ` · ${t("admin.lifted")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="admin-chat-lookup">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const room = window.prompt(t("admin.chatRoomPrompt"));
                        if (room) {
                          setChatLog(await fetchChatLog(token, room.trim().toUpperCase()));
                        }
                      })
                    }
                  >
                    {t("admin.fetchChatButton")}
                  </button>
                  {chatLog && (
                    <div className="admin-evidence">
                      {chatLog.length === 0 && <p className="hint">{t("admin.noEvidence")}</p>}
                      {chatLog.map((line, index) => (
                        <p
                          key={index}
                          className={line.filtered ? "admin-chat-line admin-chat-filtered" : "admin-chat-line"}
                        >
                          <span className="admin-chat-sender">{line.senderName}</span>
                          <span>{line.text}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="error">{t(`admin.errors.${error}`, t("admin.errors.unknown"))}</p>}
      </div>
    </div>
  );
}
