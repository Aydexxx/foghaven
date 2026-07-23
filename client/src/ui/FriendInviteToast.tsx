import { useTranslation } from "react-i18next";

interface FriendInviteToastProps {
  fromUsername: string;
  busy: boolean;
  onJoin: () => void;
  onDismiss: () => void;
}

/**
 * "So-and-so invited you to a game" — delivered the instant `HubRoom`
 * forwards it (see `App.tsx`'s `friendInvite` listener), from wherever the
 * player currently is: the menu, another room's lobby, mid-round. Joining
 * goes through the same `joinRoomByCode` path as typing a code in by hand;
 * this is only ever a shortcut to that, never a separate mechanism.
 */
export function FriendInviteToast({ fromUsername, busy, onJoin, onDismiss }: FriendInviteToastProps) {
  const { t } = useTranslation();
  return (
    <div className="friend-invite-toast" role="alertdialog" aria-live="assertive">
      <p>{t("friendInvite.message", { name: fromUsername })}</p>
      <div className="friend-invite-toast-actions">
        <button type="button" onClick={onJoin} disabled={busy}>
          {busy ? t("friendInvite.joiningButton") : t("friendInvite.joinButton")}
        </button>
        <button type="button" className="secondary" onClick={onDismiss} disabled={busy}>
          {t("friendInvite.dismissButton")}
        </button>
      </div>
    </div>
  );
}
