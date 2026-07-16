/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the Foghaven Colyseus server. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
