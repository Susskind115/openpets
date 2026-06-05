export { updateCloudBrainState } from "../app-state.js";
export type { CloudBrainState } from "../app-state.js";
import { getAppStateSnapshot } from "../app-state.js";
import type { CloudBrainState } from "../app-state.js";

export function getCloudBrainConfig(): CloudBrainState {
  return getAppStateSnapshot().cloudBrain;
}
