import { useTranslation } from "react-i18next";

/**
 * The `Suspense` fallback for lazy-loaded screens (currently just `GameView`,
 * which is what pulls in Phaser — see `App.tsx`). A dynamic `import()` has no
 * byte-level progress to report, so this is an indeterminate spinner rather
 * than a fabricated percentage.
 */
export function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <p>{t("app.loading")}</p>
    </div>
  );
}
