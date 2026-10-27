import "server-only";

import "../domain/events";

export { registerTasksEventHandlers } from "./events";
export { milestoneProgress, projectProgress } from "./progress";
export { addDependency, removeDependency } from "./dependencies";
export {
  getTask,
  getTaskDetail,
  listTasks,
  listTimeline,
  listTopLevelTasks,
  loadTasks,
} from "./repository";
export {
  completeTask,
  createTask,
  deleteTask,
  emptyTrash,
  moveTask,
  purgeTask,
  reopenTask,
  restoreTask,
  setTaskParent,
  setTaskStatus,
  updateTask,
  type TaskDeps,
} from "./service";
export { listStatuses, seedDefaultStatuses } from "./statuses";
export { listTags } from "./tags";
export { listTrash } from "./trash";
export { getTaskViewScope, updateTaskViewScope } from "./views";
export { tasksRouter } from "./router";
