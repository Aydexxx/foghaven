import type { Ability } from "./types";
import { killAbility } from "./kill";
import { protectAbility } from "./protect";
import { healAbility } from "./heal";
import { investigateAbility } from "./investigate";
import { lightLampAbility } from "./lightLamp";
import { placeCameraAbility } from "./placeCamera";
import { communeAbility } from "./commune";
import { doubleVoteAbility } from "./doubleVote";
import { executeShotAbility } from "./executeShot";
import { sabotageAbility } from "./sabotage";
import { advancedSabotageAbility } from "./advancedSabotage";
import { lockDoorAbility } from "./lockDoor";
import { tunnelAbility } from "./tunnel";
import { shapeshiftAbility } from "./shapeshift";
import { assassinateAbility } from "./assassinate";
import { silenceAbility } from "./silence";
import { commsAbility } from "./comms";
import { criticalSabotageAbility } from "./criticalSabotage";

/**
 * Every ability the server knows, by the id role definitions reference
 * (each `RoleDefinition.abilities[].ability` in `shared/config/roles.ts`).
 * Registering a new ability here is the one server-side line a new role
 * needs beyond its own ability file.
 */
export const ABILITIES: Record<string, Ability> = {
  [killAbility.id]: killAbility,
  [protectAbility.id]: protectAbility,
  [healAbility.id]: healAbility,
  [investigateAbility.id]: investigateAbility,
  [lightLampAbility.id]: lightLampAbility,
  [placeCameraAbility.id]: placeCameraAbility,
  [communeAbility.id]: communeAbility,
  [doubleVoteAbility.id]: doubleVoteAbility,
  [executeShotAbility.id]: executeShotAbility,
  [sabotageAbility.id]: sabotageAbility,
  [advancedSabotageAbility.id]: advancedSabotageAbility,
  [lockDoorAbility.id]: lockDoorAbility,
  [tunnelAbility.id]: tunnelAbility,
  [shapeshiftAbility.id]: shapeshiftAbility,
  [assassinateAbility.id]: assassinateAbility,
  [silenceAbility.id]: silenceAbility,
  [commsAbility.id]: commsAbility,
  [criticalSabotageAbility.id]: criticalSabotageAbility,
};

export {
  protectedIds,
  cameras,
  voteWeights,
  type Ability,
  type AbilityContext,
  type CameraRecord,
} from "./types";
