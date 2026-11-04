import "server-only";
import * as asana from "./asana";
import { usesAsana } from "../config/env";
import * as native from "./native";

// Where the portal's tasks live: the Supabase tables by default, or Asana with
// TASK_BACKEND=asana. Pages and operations import from here, never a backend.

const backend = () => (usesAsana() ? asana : native);

export * from "./model";

export const verifiedProject: typeof asana.verifiedProject = (key) => backend().verifiedProject(key);
export const projectKeyOfTask: typeof asana.projectKeyOfTask = (task) => backend().projectKeyOfTask(task);
export const listTasks: typeof asana.listTasks = (key, options) => backend().listTasks(key, options);
export const getTask: typeof asana.getTask = (gid) => backend().getTask(gid);
export const updateTask: typeof asana.updateTask = (gid, changes) => backend().updateTask(gid, changes);
export const addComment: typeof asana.addComment = (gid, text) => backend().addComment(gid, text);
export const listComments: typeof asana.listComments = (gid) => backend().listComments(gid);
export const listStatusUpdates: typeof asana.listStatusUpdates = (key, since) => backend().listStatusUpdates(key, since);
export const createStatusUpdate: typeof asana.createStatusUpdate = (key, update) => backend().createStatusUpdate(key, update);
