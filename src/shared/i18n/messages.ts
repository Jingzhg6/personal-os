import areas from "../../../messages/zh-CN/areas.json";
import auth from "../../../messages/zh-CN/auth.json";
import character from "../../../messages/zh-CN/character.json";
import common from "../../../messages/zh-CN/common.json";
import dashboard from "../../../messages/zh-CN/dashboard.json";
import editor from "../../../messages/zh-CN/editor.json";
import errors from "../../../messages/zh-CN/errors.json";
import nav from "../../../messages/zh-CN/nav.json";
import projects from "../../../messages/zh-CN/projects.json";
import rewards from "../../../messages/zh-CN/rewards.json";
import settings from "../../../messages/zh-CN/settings.json";
import shell from "../../../messages/zh-CN/shell.json";
import tasks from "../../../messages/zh-CN/tasks.json";

/** The zh-CN catalogue: the only UI language. */
export const sourceMessages = {
  common,
  nav,
  shell,
  auth,
  settings,
  errors,
  editor,
  areas,
  tasks,
  projects,
  character,
  rewards,
  dashboard,
};

export type Messages = typeof sourceMessages;
