import "server-only";

import "../domain/events";

export { projectsRouter } from "./router";
export {
  createMilestone,
  createProject,
  deleteProject,
  getProjectDetail,
  listProjects,
  updateProject,
} from "./service";
