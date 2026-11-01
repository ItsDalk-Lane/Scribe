import { ProjectConfig } from "@/aiParams";

export const EMPTY_PROJECT_CONFIG: ProjectConfig = {
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  contextSource: {},
  created: 0,
  UsageTimestamps: 0,
};

export const COPILOT_PROJECT_ID = "scribe-project-id";
export const COPILOT_PROJECT_NAME = "scribe-project-name";
export const COPILOT_PROJECT_DESCRIPTION = "scribe-project-description";
export const COPILOT_PROJECT_CREATED = "scribe-project-created";
export const COPILOT_PROJECT_LAST_USED = "scribe-project-last-used";
export const COPILOT_PROJECT_INCLUSIONS = "scribe-project-inclusions";
export const COPILOT_PROJECT_EXCLUSIONS = "scribe-project-exclusions";
export const COPILOT_PROJECT_WEB_URLS = "scribe-project-web-urls";
export const COPILOT_PROJECT_YOUTUBE_URLS = "scribe-project-youtube-urls";

export const PROJECT_CONFIG_FILE_NAME = "project.md";

export const PROJECTS_UNSUPPORTED_FOLDER_NAME = "unsupported";
