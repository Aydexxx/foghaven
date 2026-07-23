import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  FriendError,
  acceptFriendRequest,
  blockUser,
  declineFriendRequest,
  listBlocked,
  listFriendRequests,
  listFriends,
  removeFriend,
  sendFriendRequest,
  unblockUser,
  type Friend,
  type FriendRequestSummary,
  type FriendUserRef,
} from "../net/friends";
import {
  sendInvite,
  type FriendAcceptedMessage,
  type FriendOfflineMessage,
  type FriendOnlineMessage,
  type InviteResultMessage,
} from "../net/hub";

interface FriendsPanelProps {
  token: string;
  /** The always-open social connection — null while it's still connecting. */
  hub: Room | null;
  /** The current room's code, so a friend can be invited straight into it; null outside a room. */
  activeRoomCode: string | null;
  onClose: () => void;
}

type Tab = "friends" | "requests" | "blocked";

/** Server error codes this screen knows how to explain — everything else falls back to `unknown`. */
const ERROR_KEY: Record<string, string> = {
  not_found: "friendsPanel.errors.notFound",
  self: "friendsPanel.errors.self",
  already_friends: "friendsPanel.errors.alreadyFriends",
  already_pending: "friendsPanel.errors.alreadyPending",
  blocked: "friendsPanel.errors.blocked",
};

/**
 * Add/remove/block friends, seen from the main menu or from inside a room's
 * waiting lobby — see `App.tsx` for where it's mounted and `HubRoom` for the
 * realtime presence/notification channel it listens to while open.
 *
 * Everything here is a *request* to the server the same way the lobby's role
 * toggles are: an action fires the HTTP call and then re-pulls the three
 * lists, rather than optimistically mutating local state, since a friend
 * action failing silently (a stale block, a request that was already
 * accepted from the other side) is worse than one extra round trip.
 */
export function FriendsPanel({ token, hub, activeRoomCode, onClose }: FriendsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestSummary[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestSummary[]>([]);
  const [blocked, setBlocked] = useState<FriendUserRef[]>([]);
  const [addUsername, setAddUsername] = useState("");
  const [blockUsername, setBlockUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justInvited, setJustInvited] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const [f, requests, b] = await Promise.all([
      listFriends(token),
      listFriendRequests(token),
      listBlocked(token),
    ]);
    setFriends(f);
    setIncoming(requests.incoming);
    setOutgoing(requests.outgoing);
    setBlocked(b);
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates while the panel is open — a friend's presence flipping, a
  // fresh request landing, one of this player's own requests being accepted
  // from the other side — all delivered instantly over the hub rather than
  // waited out until the next time this panel happens to reopen.
  useEffect(() => {
    if (!hub) {
      return;
    }
    const offOnline = hub.onMessage<FriendOnlineMessage>("friendOnline", (msg) =>
      setFriends((prev) => prev.map((f) => (f.id === msg.userId ? { ...f, online: true } : f))),
    );
    const offOffline = hub.onMessage<FriendOfflineMessage>("friendOffline", (msg) =>
      setFriends((prev) => prev.map((f) => (f.id === msg.userId ? { ...f, online: false } : f))),
    );
    const offRequest = hub.onMessage("friendRequest", () => void refresh());
    const offAccepted = hub.onMessage<FriendAcceptedMessage>("friendAccepted", () => void refresh());
    // Feedback for an invite this player just sent — a friend going offline
    // between opening this panel and clicking "Invite" is the common case
    // this catches, since the button is only shown for friends already
    // known to be online.
    const offInviteResult = hub.onMessage<InviteResultMessage>("inviteResult", (msg) => {
      if (msg.delivered) {
        return;
      }
      setError(
        msg.reason === "offline"
          ? "friendsPanel.errors.inviteOffline"
          : msg.reason === "blocked"
            ? "friendsPanel.errors.blocked"
            : "friendsPanel.errors.inviteNotFriends",
      );
    });
    return () => {
      offOnline();
      offOffline();
      offRequest();
      offAccepted();
      offInviteResult();
    };
  }, [hub, refresh]);

  const withBusy = (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void fn()
      .catch((err) => {
        setError(err instanceof FriendError ? (ERROR_KEY[err.code] ?? "friendsPanel.errors.unknown") : "friendsPanel.errors.unknown");
      })
      .finally(() => setBusy(false));
  };

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const username = addUsername.trim();
    if (!username) {
      return;
    }
    withBusy(async () => {
      await sendFriendRequest(token, username);
      setAddUsername("");
      await refresh();
    });
  };

  const handleBlockByName = (event: FormEvent) => {
    event.preventDefault();
    const username = blockUsername.trim();
    if (!username) {
      return;
    }
    withBusy(async () => {
      await blockUser(token, username);
      setBlockUsername("");
      await refresh();
    });
  };

  const handleInvite = (friend: Friend) => {
    if (!hub || !activeRoomCode) {
      return;
    }
    sendInvite(hub, friend.id, activeRoomCode);
    setJustInvited((prev) => new Set(prev).add(friend.id));
    setTimeout(() => {
      setJustInvited((prev) => {
        const next = new Set(prev);
        next.delete(friend.id);
        return next;
      });
    }, 2000);
  };

  return (
    <div className="friends-overlay" role="dialog" aria-label={t("friendsPanel.heading")}>
      <div className="friends-panel">
        <div className="friends-panel-header">
          <h2>{t("friendsPanel.heading")}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t("friendsPanel.closeButton")}
          </button>
        </div>

        <div className="friends-tabs">
          <button
            type="button"
            className={tab === "friends" ? "friends-tab friends-tab-active" : "friends-tab"}
            onClick={() => setTab("friends")}
          >
            {t("friendsPanel.tabs.friends", { count: friends.length })}
          </button>
          <button
            type="button"
            className={tab === "requests" ? "friends-tab friends-tab-active" : "friends-tab"}
            onClick={() => setTab("requests")}
          >
            {t("friendsPanel.tabs.requests", { count: incoming.length })}
          </button>
          <button
            type="button"
            className={tab === "blocked" ? "friends-tab friends-tab-active" : "friends-tab"}
            onClick={() => setTab("blocked")}
          >
            {t("friendsPanel.tabs.blocked")}
          </button>
        </div>

        {tab === "friends" && (
          <>
            <form className="friends-add-form" onSubmit={handleAdd}>
              <input
                type="text"
                value={addUsername}
                placeholder={t("friendsPanel.addPlaceholder")}
                onChange={(e) => setAddUsername(e.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !addUsername.trim()}>
                {t("friendsPanel.addButton")}
              </button>
            </form>

            {outgoing.length > 0 && (
              <ul className="friends-list friends-list-pending">
                {outgoing.map((req) => (
                  <li key={req.id}>
                    <span className="friend-name">{req.addressee.username}</span>
                    <span className="hint">{t("friendsPanel.pendingTag")}</span>
                  </li>
                ))}
              </ul>
            )}

            <ul className="friends-list">
              {friends.length === 0 && <li className="hint">{t("friendsPanel.noFriends")}</li>}
              {friends.map((friend) => (
                <li key={friend.id}>
                  <span
                    className={friend.online ? "friend-status friend-status-online" : "friend-status"}
                    aria-hidden="true"
                  />
                  <span className="friend-name">{friend.username}</span>
                  {activeRoomCode && friend.online && (
                    <button type="button" className="secondary" disabled={busy} onClick={() => handleInvite(friend)}>
                      {justInvited.has(friend.id) ? t("friendsPanel.invitedButton") : t("friendsPanel.inviteButton")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() => withBusy(async () => {
                      await removeFriend(token, friend.id);
                      await refresh();
                    })}
                  >
                    {t("friendsPanel.removeButton")}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() => withBusy(async () => {
                      await blockUser(token, friend.username);
                      await refresh();
                    })}
                  >
                    {t("friendsPanel.blockButton")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "requests" && (
          <ul className="friends-list">
            {incoming.length === 0 && <li className="hint">{t("friendsPanel.noRequests")}</li>}
            {incoming.map((req) => (
              <li key={req.id}>
                <span className="friend-name">{req.requester.username}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => withBusy(async () => {
                    await acceptFriendRequest(token, req.id);
                    await refresh();
                  })}
                >
                  {t("friendsPanel.acceptButton")}
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() => withBusy(async () => {
                    await declineFriendRequest(token, req.id);
                    await refresh();
                  })}
                >
                  {t("friendsPanel.declineButton")}
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === "blocked" && (
          <>
            <form className="friends-add-form" onSubmit={handleBlockByName}>
              <input
                type="text"
                value={blockUsername}
                placeholder={t("friendsPanel.blockPlaceholder")}
                onChange={(e) => setBlockUsername(e.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !blockUsername.trim()}>
                {t("friendsPanel.blockButton")}
              </button>
            </form>
            <ul className="friends-list">
              {blocked.length === 0 && <li className="hint">{t("friendsPanel.noBlocked")}</li>}
              {blocked.map((user) => (
                <li key={user.id}>
                  <span className="friend-name">{user.username}</span>
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() => withBusy(async () => {
                      await unblockUser(token, user.id);
                      await refresh();
                    })}
                  >
                    {t("friendsPanel.unblockButton")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && <p className="error">{t(error)}</p>}
      </div>
    </div>
  );
}
