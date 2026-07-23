import { useTranslation } from "react-i18next";

interface LegalPageProps {
  doc: "privacy" | "terms";
  onClose: () => void;
}

/**
 * Privacy Policy / Terms of Service, in one component switched by `doc` —
 * there is no meaningful UI difference between the two, only which body text
 * renders. Reachable both signed out (from `AuthScreen`, so a player can read
 * either before ever checking the consent box) and signed in (from
 * `MainMenu`/`ProfilePanel`), which is why `App.tsx` owns this as a top-level
 * overlay rather than a child of either screen.
 *
 * The body text lives in `common.json` as a single long string per document
 * (`legal.privacy.body`/`legal.terms.body`), paragraph breaks and all,
 * rather than one i18n key per paragraph — this is prose meant to be read in
 * order, not a form to be recomposed, and a wall of `legal.privacy.p1`,
 * `.p2`, `.p3`... keys would make future edits (a clause added, reordered,
 * split) touch this component too. `white-space: pre-wrap` on the render
 * target is what makes the `\n\n` breaks in that string actually show up.
 */
export function LegalPage({ doc, onClose }: LegalPageProps) {
  const { t } = useTranslation();

  return (
    <div className="legal-overlay" role="dialog" aria-label={t(`legal.${doc}.title`)}>
      <div className="legal-panel">
        <div className="legal-header">
          <h2>{t(`legal.${doc}.title`)}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t("legal.closeButton")}
          </button>
        </div>
        <p className="legal-updated">{t("legal.lastUpdated", { date: t(`legal.${doc}.updated`) })}</p>
        <div className="legal-body">{t(`legal.${doc}.body`)}</div>
      </div>
    </div>
  );
}
