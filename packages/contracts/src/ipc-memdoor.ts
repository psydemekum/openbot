import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { isAgentModel } from "./ipc-agent-identity";
import { CUSTOM_PROVIDER_ID_PATTERN } from "./ipc-custom-providers";
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
export const MEMDOOR_MODEL_CHOICE_LIMIT = 256;

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
  modelSources?: string[];
}

export interface SaveMemdoorTeamSettings extends MemdoorTeamConfig {
  agentId: string;
  /** Leave absent to keep the API key. Only an explicit local settings save can replace it. */
  apiKey?: string | undefined;
}

export function memdoorModelChoice(provider: string, id: string): string {
  return provider === "codex" ? id : `${provider}:${id}`;
}

export function parseMemdoorModelChoice(value: string): { provider: AgentProviderId; id: string } | null {
  if (MEMDOOR_MODEL_PATTERN.test(value)) return { provider: "codex", id: value };
  const separator = value.indexOf(":");
  if (separator <= 0 || value.length > MEMDOOR_MODEL_CHOICE_LIMIT) return null;
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!isAgentProvider(provider) || provider === "codex" || !isAgentModel(id)) return null;
  if (provider === "antigravity" && !/^(?:models\/)?gemini-/u.test(id)) return null;
  return { provider, id };
}

export function memdoorModelSource(provider: string, id: string): string | null {
  if (provider === "opencode" || provider === "pi") {
    const separator = id.indexOf("/");
    const endpoint = id.slice(0, separator);
    return separator > 0 && CUSTOM_PROVIDER_ID_PATTERN.test(endpoint) ? `${provider}:${endpoint}/` : null;
  }
  return isAgentProvider(provider) ? provider : null;
}

export function memdoorModelAvailable(sources: readonly string[] | undefined, provider: string, id: string): boolean {
  const model = parseMemdoorModelChoice(memdoorModelChoice(provider, id));
  if (!model || model.provider !== provider) return false;
  if (model.provider === "codex") return true;
  const source = memdoorModelSource(model.provider, model.id);
  return source !== null && (sources?.includes(source) ?? false);
}

function isMemdoorModelSource(value: unknown): value is string {
  if (isAgentProvider(value)) return true;
  if (typeof value !== "string" || value.length > MEMDOOR_MODEL_CHOICE_LIMIT || !value.endsWith("/")) return false;
  const separator = value.indexOf(":");
  return separator > 0 && memdoorModelSource(value.slice(0, separator), value.slice(separator + 1)) === value;
}

export function isLegacyMemdoorTeamConfig(config: MemdoorTeamConfig): boolean {
  return (
    MEMDOOR_MODEL_PATTERN.test(config.teamModel) &&
    Object.values(config.roles).every(({ model }) => model === "" || MEMDOOR_MODEL_PATTERN.test(model))
  );
}

export function isMemdoorTeamConfig(value: unknown): value is MemdoorTeamConfig {
  return (
    isDynamicRecord(value) &&
    typeof value.teamModel === "string" &&
    parseMemdoorModelChoice(value.teamModel) !== null &&
    typeof value.decisionModel === "string" &&
    MEMDOOR_MODEL_PATTERN.test(value.decisionModel) &&
    isDynamicRecord(value.roles) &&
    Object.entries(value.roles).every(
      ([id, role]) =>
        isOneOf(MEMDOOR_ROLE_IDS, id) &&
        isDynamicRecord(role) &&
        typeof role.model === "string" &&
        (role.model === "" || parseMemdoorModelChoice(role.model) !== null) &&
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
    isOneOf(["ready", "missing", "git-missing"] as const, value.runtime) &&
    (!("modelSources" in value) ||
      (Array.isArray(value.modelSources) && value.modelSources.every(isMemdoorModelSource)))
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
