import { TASK_ROOM_ANCHOR } from "../map/townMap";

/** The four task shapes used for assignment (who gets what, how many extras). */
export type TaskType = "short" | "long" | "common" | "visual";

/**
 * The six mini-game interactions a task point can present. This is a purely
 * client-side rendering concern — the server never looks at it. Every step of
 * a task uses the same mini-game, freshly randomised each time it's played.
 */
export type MinigameType = "wires" | "code" | "calibration" | "pattern" | "ordering" | "rotation";

/**
 * A single stage of a task. Steps are placeholders for now — completing one
 * currently just means finishing the assigned mini-game once. Multi-step
 * ("long") tasks play the same mini-game again for each remaining step.
 */
export interface TaskStep {
  id: string;
}

/** A task's room, restricted to the rooms a task can actually sit in — not Town Hall (bell only) or the Streets (transit only). */
export type TaskRoomSlug = keyof typeof TASK_ROOM_ANCHOR;

/**
 * A task point on the map: where it is, what kind it is, how many stages it
 * has. `room` is the English slug the server and both clients agree on; the
 * display name is an i18n lookup (`rooms.<slug>`) done wherever this is
 * rendered, never stored here.
 */
export interface TaskDefinition {
  id: string;
  type: TaskType;
  minigame: MinigameType;
  room: TaskRoomSlug;
  x: number;
  y: number;
  steps: TaskStep[];
}

/** Distance, in world units, within which a player may interact with a task. */
export const TASK_INTERACT_RADIUS = 40;

/** Every "common" task is dealt to every player, plus this many random extras. */
export const RANDOM_TASKS_PER_PLAYER = 4;

/**
 * One task per room that can hold one, positioned at that room's interior
 * center (`TASK_ROOM_ANCHOR`, from the town map) rather than a hand-picked
 * number — so a task can never end up off the walkable grid by a stray
 * coordinate, and moving a room in the map moves its task with it for free.
 */
export const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  {
    id: "wire-the-lamp",
    type: "short",
    minigame: "wires",
    room: "lighthouse",
    ...TASK_ROOM_ANCHOR.lighthouse,
    steps: [{ id: "1" }],
  },
  {
    id: "calibrate-the-crane",
    type: "long",
    minigame: "calibration",
    room: "warehouse",
    ...TASK_ROOM_ANCHOR.warehouse,
    steps: [{ id: "1" }, { id: "2" }, { id: "3" }],
  },
  {
    id: "read-the-chart",
    type: "visual",
    minigame: "pattern",
    room: "infirmary",
    ...TASK_ROOM_ANCHOR.infirmary,
    steps: [{ id: "1" }],
  },
  {
    id: "sign-the-ledger",
    type: "common",
    minigame: "code",
    room: "tavern",
    ...TASK_ROOM_ANCHOR.tavern,
    steps: [{ id: "1" }],
  },
  {
    id: "trim-the-wicks",
    type: "short",
    minigame: "ordering",
    room: "lampRoom",
    ...TASK_ROOM_ANCHOR.lampRoom,
    steps: [{ id: "1" }],
  },
  {
    id: "decode-the-manifest",
    type: "long",
    minigame: "code",
    room: "cellar",
    ...TASK_ROOM_ANCHOR.cellar,
    steps: [{ id: "1" }, { id: "2" }],
  },
  {
    id: "weigh-the-catch",
    type: "short",
    minigame: "rotation",
    room: "fishMarket",
    ...TASK_ROOM_ANCHOR.fishMarket,
    steps: [{ id: "1" }],
  },
  {
    id: "adjust-the-winch",
    type: "visual",
    minigame: "calibration",
    room: "docks",
    ...TASK_ROOM_ANCHOR.docks,
    steps: [{ id: "1" }],
  },
];

export const TASK_DEFINITIONS_BY_ID: ReadonlyMap<string, TaskDefinition> = new Map(
  TASK_DEFINITIONS.map((task) => [task.id, task]),
);

/**
 * The private, per-player view of one assigned task: definition data plus this
 * player's own progress. Sent to exactly one client — see `GameRoom.assignTasks`.
 * The shape is identical whether the underlying task is real or fake, which is
 * what makes a stranger's task list indistinguishable from a townsfolk's.
 */
export interface ClientTask {
  id: string;
  type: TaskType;
  minigame: MinigameType;
  room: TaskRoomSlug;
  x: number;
  y: number;
  totalSteps: number;
  completedSteps: number;
}

/** The initial private task list, sent once as gameplay begins. */
export interface TasksMessage {
  tasks: ClientTask[];
}

/** One step of progress on a single task, sent after every interaction. */
export interface TaskProgressMessage {
  taskId: string;
  completedSteps: number;
}
