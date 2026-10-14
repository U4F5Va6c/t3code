import { createWorkItemsEnvironmentAtoms } from "@t3tools/client-runtime/state/workItems";
import { connectionAtomRuntime } from "../connection/runtime";
export const workItemsEnvironment = createWorkItemsEnvironmentAtoms(connectionAtomRuntime);
