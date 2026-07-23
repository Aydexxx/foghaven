import { EventEmitter } from "node:events";

/**
 * The in-process bridge between the `/friends` HTTP routes and `HubRoom`.
 *
 * They live in the same Node process but don't otherwise know about each
 * other — the HTTP layer has no reference to the live room instance, and
 * reaching across via `matchMaker` for what is, on a single process, a plain
 * function call would be needless indirection. A request lands over HTTP, a
 * delivery needs to reach a specific open WebSocket; this event bus is the
 * seam between the two.
 *
 * Deliberately process-local. A multi-instance deployment would need this
 * replaced with real pub/sub (Redis, same as `presenceStore.ts`) so a
 * request handled by instance A can reach a socket held open on instance B —
 * out of scope while there's only ever one server process.
 */
export interface HubEvents {
  /** A pending request just arrived for `toUserId`. */
  friendRequest: [payload: { toUserId: string; requestId: string; fromUserId: string; fromUsername: string }];
  /** `toUserId`'s outgoing request was just accepted. */
  friendAccepted: [payload: { toUserId: string; friendUserId: string; friendUsername: string }];
}

class HubEventBus extends EventEmitter {
  override emit<K extends keyof HubEvents>(event: K, ...args: HubEvents[K]): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof HubEvents>(event: K, listener: (...args: HubEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends keyof HubEvents>(event: K, listener: (...args: HubEvents[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const hubEvents = new HubEventBus();
