import { isDynamicRecord, isOneOf } from "./runtime-values";

export const MEMDOOR_AGENT_ID = "agent-memdoor-team";
export const MEMDOOR_RUNTIME_ID = "memdoor-team";
export const MEMDOOR_TEAM_MODEL = "gpt-6.2-sol";
export const MEMDOOR_DECISION_MODEL = "gpt-6-luna";
export const MEMDOOR_ROLE_IDS = [
  "reproduce",
  "direct-a",
  "direct-b",
  "direct-c",
  "ideate",
  "plan",
  "solve",
  "judge",
  "review",
  "repair",
] as const;

export const MEMDOOR_EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;
export const MEMDOOR_PROMPT_LIMIT = 8_000;
export const MEMDOOR_MODEL_PATTERN = /^gpt-[a-z0-9][a-z0-9.-]{0,79}$/u;

export type MemdoorRoleId = (typeof MEMDOOR_ROLE_IDS)[number];

export type MemdoorRole = {
  model: string;
  effort: (typeof MEMDOOR_EFFORTS)[number];
  prompt: string;
};

export interface MemdoorTeamConfig {
  teamModel: string;
  decisionModel: string;
  roles: Partial<Record<MemdoorRoleId, MemdoorRole>>;
}

export interface MemdoorTeamSettings extends MemdoorTeamConfig {
  hasApiKey: boolean;
  runtime: "ready" | "missing" | "git-missing";
}

export interface SaveMemdoorTeamSettings extends MemdoorTeamConfig {
  agentId: string;
  /** Leave absent to keep the API key. Only an explicit local settings save can replace it. */
  apiKey?: string | undefined;
}

export function isMemdoorTeamConfig(value: unknown): value is MemdoorTeamConfig {
  return (
    isDynamicRecord(value) &&
    typeof value.teamModel === "string" &&
    MEMDOOR_MODEL_PATTERN.test(value.teamModel) &&
    typeof value.decisionModel === "string" &&
    MEMDOOR_MODEL_PATTERN.test(value.decisionModel) &&
    isDynamicRecord(value.roles) &&
    Object.entries(value.roles).every(
      ([id, role]) =>
        isOneOf(MEMDOOR_ROLE_IDS, id) &&
        isDynamicRecord(role) &&
        typeof role.model === "string" &&
        (role.model === "" || MEMDOOR_MODEL_PATTERN.test(role.model)) &&
        isOneOf(MEMDOOR_EFFORTS, role.effort) &&
        typeof role.prompt === "string" &&
        role.prompt.length <= MEMDOOR_PROMPT_LIMIT,
    )
  );
}

export function isMemdoorTeamSettings(value: unknown): value is MemdoorTeamSettings {
  return (
    isDynamicRecord(value) &&
    isMemdoorTeamConfig(value) &&
    typeof value.hasApiKey === "boolean" &&
    isOneOf(["ready", "missing", "git-missing"] as const, value.runtime)
  );
}

export function isSaveMemdoorTeamSettings(value: unknown): value is SaveMemdoorTeamSettings {
  return (
    isDynamicRecord(value) &&
    isMemdoorTeamConfig(value) &&
    value.agentId === MEMDOOR_AGENT_ID &&
    (value.apiKey === undefined ||
      (typeof value.apiKey === "string" && value.apiKey.length <= 4_096 && /^sk-\S+$/u.test(value.apiKey)))
  );
}
