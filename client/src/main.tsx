import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { useTranslation } from "react-i18next";
import "./i18n";
import "./index.css";
import App from "./App";

// A no-op (nothing sent, no wrapping overhead) when the build didn't set
// VITE_SENTRY_DSN — the normal case in local dev. The browser SDK
// auto-instruments window.onerror/unhandledrejection once initialized, which
// is most of what the client never had before this.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0,
});

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element not found");
}

/**
 * The app's first error boundary. A render-time exception anywhere below
 * this used to mean a blank white screen with nothing in any log; now it's a
 * minimal reload prompt, and Sentry gets the crash either way.
 */
function Fallback() {
  const { t } = useTranslation();
  return (
    <div className="app" style={{ textAlign: "center" }}>
      <p>{t("app.crashFallback")}</p>
    </div>
  );
}

createRoot(container).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<Fallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
