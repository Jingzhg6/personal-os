import "server-only";

import "../domain/events";

export { registerTasksEventHandlers } from "./events";
export { getTask, getTaskDetail, listTopLevelTasks, loadTasks } from "./repository";
export {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  setTaskStatus,
  updateTask,
  type TaskDeps,
} from "./service";
export { listStatuses, seedDefaultStatuses } from "./statuses";
export { listTags } from "./tags";
export { tasksRouter } from "./router";
