import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { REPORT_REASONS, REPORT_NOTE_MAX_LENGTH, type ReportReason } from "@foghaven/shared";

interface ReportDialogProps {
  /** Who is being reported — display name only; the server resolves the account itself. */
  targetName: string;
  onSubmit: (reason: ReportReason, note: string) => void;
  onClose: () => void;
}

/**
 * Report a player: pick a reason, optionally say more.
 *
 * Deliberately a small, boring form. Reporting has to be quick enough that
 * someone does it in the two seconds before the next round starts, or it
 * doesn't get done at all — so there is one required choice and one optional
 * field, and nothing else in the way.
 *
 * The reason list is rendered from the shared registry, so the client can
 * never offer a reason the server would reject as invented.
 */
export function ReportDialog({ targetName, onSubmit, onClose }: ReportDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reason) {
      return;
    }
    onSubmit(reason, note.trim());
  };

  return (
    <div className="report-overlay" role="dialog" aria-label={t("report.heading")}>
      <form className="report-panel" onSubmit={submit}>
        <h2>{t("report.heading", { name: targetName })}</h2>

        <ul className="report-reasons">
          {REPORT_REASONS.map((option) => (
            <li key={option}>
              <label>
                <input
                  type="radio"
                  name="report-reason"
                  value={option}
                  checked={reason === option}
                  onChange={() => setReason(option)}
                />
                <span>{t(`report.reasons.${option}`)}</span>
              </label>
            </li>
          ))}
        </ul>

        <label className="field">
          <span>{t("report.noteLabel")}</span>
          <textarea
            value={note}
            maxLength={REPORT_NOTE_MAX_LENGTH}
            rows={3}
            placeholder={t("report.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="report-actions">
          <button type="submit" disabled={!reason}>
            {t("report.submitButton")}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t("report.cancelButton")}
          </button>
        </div>

        <p className="hint">{t("report.disclaimer")}</p>
      </form>
    </div>
  );
}
