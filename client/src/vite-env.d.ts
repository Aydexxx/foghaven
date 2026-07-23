/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the Foghaven Colyseus server. */
  readonly VITE_SERVER_URL?: string;
  /** Sentry DSN for client-side error tracking. Build-time only; unset disables Sentry entirely. */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
