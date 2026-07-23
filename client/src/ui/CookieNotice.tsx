import { useTranslation } from "react-i18next";

interface CookieNoticeProps {
  onDismiss: () => void;
  onOpenPrivacy: () => void;
}

/**
 * A one-time disclosure banner for the browser storage this app actually
 * uses: `localStorage` for the auth token (`net/auth.ts`) and the
 * reconnection seat (`net/session.ts`) — never a cross-site tracking cookie,
 * and never anything ads or analytics could read. Both are "strictly
 * necessary" storage under GDPR/ePrivacy (you can't stay signed in or
 * reconnect to a dropped game without them), which is why this is a notice
 * with one dismiss button rather than an accept/reject choice — there is no
 * optional storage here to opt out of.
 *
 * Dismissal is itself remembered in `localStorage`, which is a little
 * self-referential but is the standard, simplest way to make a notice show
 * exactly once per browser.
 */
export function CookieNotice({ onDismiss, onOpenPrivacy }: CookieNoticeProps) {
  const { t } = useTranslation();

  return (
    <div className="cookie-notice" role="status">
      <p>
        {t("cookieNotice.text")}{" "}
        <button type="button" className="link-button" onClick={onOpenPrivacy}>
          {t("cookieNotice.learnMore")}
        </button>
      </p>
      <button type="button" onClick={onDismiss}>
        {t("cookieNotice.dismissButton")}
      </button>
    </div>
  );
}
