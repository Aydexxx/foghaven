import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { validateName } from "@foghaven/shared";
import { AuthError, login, register, type AuthSession } from "../net/auth";

interface AuthScreenProps {
  /** A real account signed in (login or register). */
  onAuthenticated: (session: AuthSession) => void;
  /** A guest chose a display name — no account, join-only. */
  onGuest: (name: string) => void;
  /** Opens the Privacy Policy / Terms of Service overlay — reachable before signing in, so a player can read either before checking the consent box. */
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
}

type Tab = "login" | "register" | "guest";

/** Minimum password length, mirrored from the server's `validatePassword`. */
const PASSWORD_MIN = 8;

/**
 * The entry screen: log in, register, or play as a guest. Replaces the old
 * freeform name prompt — identity now means something, because a ban can
 * attach to it. Client-side checks (name shape, password length) give instant
 * feedback via the SAME shared rules the server enforces (`validateName`), so
 * the form and the server never disagree; the server remains authoritative.
 */
export function AuthScreen({ onAuthenticated, onGuest, onOpenPrivacy, onOpenTerms }: AuthScreenProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared across the sub-forms; each only reads the fields it shows.
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);

  const errorText = (code: string, ban?: { reason: string | null }) =>
    code === "banned"
      ? t("auth.errors.banned", { reason: ban?.reason ? ` (${ban.reason})` : "" })
      : (t(`auth.errors.${code}`, { defaultValue: t("auth.errors.unknown") }) as string);

  const run = async (action: () => Promise<AuthSession>) => {
    setBusy(true);
    setError(null);
    try {
      onAuthenticated(await action());
    } catch (err) {
      if (err instanceof AuthError) {
        setError(errorText(err.code, err.ban));
      } else {
        setError(t("auth.errors.unknown"));
      }
      setBusy(false);
    }
  };

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    void run(() => login(identifier.trim(), password));
  };

  const handleRegister = (event: FormEvent) => {
    event.preventDefault();
    const nameError = validateName(username);
    if (nameError) {
      setError(errorText(nameError === "profanity" ? "profanity" : "invalid_username"));
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError(errorText("weak_password"));
      return;
    }
    if (!ageConfirmed) {
      setError(errorText("age_confirmation_required"));
      return;
    }
    if (!consentAccepted) {
      setError(errorText("consent_required"));
      return;
    }
    void run(() => register(email.trim(), username.trim(), password, ageConfirmed, consentAccepted));
  };

  const handleGuest = (event: FormEvent) => {
    event.preventDefault();
    const nameError = validateName(guestName);
    if (nameError) {
      setError(errorText(nameError === "profanity" ? "profanity" : "invalid_username"));
      return;
    }
    onGuest(guestName.trim());
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  return (
    <div className="panel auth-panel">
      <h1>{t("app.title")}</h1>

      <div className="auth-tabs" role="tablist">
        {(["login", "register", "guest"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "auth-tab auth-tab-active" : "auth-tab"}
            onClick={() => switchTab(key)}
            disabled={busy}
          >
            {t(`auth.${key}Tab`)}
          </button>
        ))}
      </div>

      {tab === "login" && (
        <form onSubmit={handleLogin}>
          <label className="field">
            <span>{t("auth.identifierLabel")}</span>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>{t("auth.passwordLabel")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !identifier.trim() || !password}>
            {busy ? t("auth.busy") : t("auth.loginButton")}
          </button>
        </form>
      )}

      {tab === "register" && (
        <form onSubmit={handleRegister}>
          <label className="field">
            <span>{t("auth.emailLabel")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>{t("auth.usernameLabel")}</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>{t("auth.passwordLabel")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
            <small className="field-hint">{t("auth.passwordHint")}</small>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              disabled={busy}
            />
            <span>{t("auth.ageConfirmLabel")}</span>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(e) => setConsentAccepted(e.target.checked)}
              disabled={busy}
            />
            <span>
              {t("auth.consentLabelPrefix")}{" "}
              <button type="button" className="link-button" onClick={onOpenTerms}>
                {t("legal.terms.title")}
              </button>{" "}
              {t("auth.consentLabelAnd")}{" "}
              <button type="button" className="link-button" onClick={onOpenPrivacy}>
                {t("legal.privacy.title")}
              </button>
            </span>
          </label>
          <button
            type="submit"
            disabled={
              busy || !email.trim() || !username.trim() || !password || !ageConfirmed || !consentAccepted
            }
          >
            {busy ? t("auth.busy") : t("auth.registerButton")}
          </button>
        </form>
      )}

      {tab === "guest" && (
        <form onSubmit={handleGuest}>
          <p className="hint">{t("auth.guestNote")}</p>
          <label className="field">
            <span>{t("auth.displayNameLabel")}</span>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              autoFocus
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !guestName.trim()}>
            {t("auth.guestButton")}
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
