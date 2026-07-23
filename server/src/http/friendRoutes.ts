import { Router, type Request, type Response } from "express";
import { getFriendProvider, type BlockError, type RespondError, type SendRequestError } from "../friends/provider";
import { getPresenceStore } from "../presence/presenceStore";
import { hubEvents } from "../presence/hubEvents";
import { verifyToken } from "../auth/token";
import { getAuthProvider } from "../auth/provider";

/**
 * The friend HTTP surface, mounted at `/friends` alongside `/auth` (see
 * `index.ts`). Every route requires a bearer token — there is no guest path,
 * since a guest has no durable account to hang a friendship off of.
 *
 * Realtime delivery (an incoming request or acceptance landing on a friend's
 * screen instantly, rather than on their next poll) is not this layer's job:
 * it happens by emitting onto `hubEvents`, which `HubRoom` listens to. This
 * router only ever touches the database and responds to the caller.
 */

const SEND_REQUEST_STATUS: Record<SendRequestError, number> = {
  not_found: 404,
  self: 400,
  already_friends: 409,
  already_pending: 409,
  blocked: 403,
};

const RESPOND_STATUS: Record<RespondError, number> = {
  not_found: 404,
  forbidden: 403,
};

const BLOCK_STATUS: Record<BlockError, number> = {
  not_found: 404,
  self: 400,
};

function bearerUserId(req: Request): string | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) {
    return null;
  }
  return verifyToken(token)?.userId ?? null;
}

/** Express middleware requiring a valid bearer token; stashes the userId on `res.locals`. */
function requireAuth(req: Request, res: Response, next: () => void): void {
  const userId = bearerUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth_invalid" });
    return;
  }
  res.locals.userId = userId;
  next();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createFriendRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (_req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const friends = await getFriendProvider().listFriends(userId);
    const online = await getPresenceStore().onlineAmong(friends.map((f) => f.id));
    res.status(200).json({
      friends: friends.map((f) => ({ ...f, online: online.has(f.id) })),
    });
  });

  router.get("/requests", async (_req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const [incoming, outgoing] = await Promise.all([
      getFriendProvider().listIncomingRequests(userId),
      getFriendProvider().listOutgoingRequests(userId),
    ]);
    res.status(200).json({ incoming, outgoing });
  });

  router.post("/requests", async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const username = asString((req.body ?? {}).username).trim();
    if (!username) {
      res.status(400).json({ error: "not_found" });
      return;
    }
    const result = await getFriendProvider().sendRequest(userId, username);
    if (!result.ok) {
      res.status(SEND_REQUEST_STATUS[result.error]).json({ error: result.error });
      return;
    }
    // A crossed request resolves straight to ACCEPTED — the recipient of
    // *this* call already knew they'd sent one, so only tell the other side
    // when it lands as a fresh, unexpected PENDING request.
    if (result.value.status === "PENDING") {
      hubEvents.emit("friendRequest", {
        toUserId: result.value.addressee.id,
        requestId: result.value.id,
        fromUserId: result.value.requester.id,
        fromUsername: result.value.requester.username,
      });
    } else {
      hubEvents.emit("friendAccepted", {
        toUserId: result.value.addressee.id,
        friendUserId: result.value.requester.id,
        friendUsername: result.value.requester.username,
      });
    }
    res.status(201).json({ request: result.value });
  });

  router.post("/requests/:id/accept", async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const result = await getFriendProvider().acceptRequest(userId, asString(req.params.id));
    if (!result.ok) {
      res.status(RESPOND_STATUS[result.error]).json({ error: result.error });
      return;
    }
    const me = await getAuthProvider().getPublicUser(userId);
    hubEvents.emit("friendAccepted", {
      toUserId: result.value.id,
      friendUserId: userId,
      friendUsername: me?.username ?? "",
    });
    res.status(200).json({ friend: result.value });
  });

  router.post("/requests/:id/decline", async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const result = await getFriendProvider().declineRequest(userId, asString(req.params.id));
    if (!result.ok) {
      res.status(RESPOND_STATUS[result.error]).json({ error: result.error });
      return;
    }
    res.status(204).end();
  });

  router.delete("/:userId", async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const result = await getFriendProvider().removeFriend(userId, asString(req.params.userId));
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.status(204).end();
  });

  router.get("/blocked", async (_req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    res.status(200).json({ blocked: await getFriendProvider().listBlocked(userId) });
  });

  router.post("/blocked", async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const username = asString((req.body ?? {}).username).trim();
    if (!username) {
      res.status(400).json({ error: "not_found" });
      return;
    }
    const result = await getFriendProvider().block(userId, username);
    if (!result.ok) {
      res.status(BLOCK_STATUS[result.error]).json({ error: result.error });
      return;
    }
    res.status(200).json({ blocked: result.value });
  });

  router.delete("/blocked/:userId", async (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    await getFriendProvider().unblock(userId, asString(req.params.userId));
    res.status(204).end();
  });

  return router;
}
