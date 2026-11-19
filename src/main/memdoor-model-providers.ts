import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { DEFAULT_CUSTOM_PROVIDER_HARNESS } from "@openbot/contracts/ipc";
import { memdoorModelSource, parseMemdoorModelChoice } from "@openbot/contracts/ipc-memdoor";
import { providerModelValue } from "../backend/encoded-model-id";
import { anthropicBaseUrl, type CustomProviderSource, usesResponsesApi } from "../backend/opencode-config";

type Api = "anthropic" | "responses" | "chat" | "openrouter";
type Connection = {
  api: Api;
  base: string;
  key: string;
  headers?: Record<string, string>;
};

const API_PROVIDERS = [
  { provider: "claude", api: "anthropic", base: "https://api.anthropic.com", variable: "ANTHROPIC_API_KEY" },
  { provider: "grok", api: "chat", base: "https://api.x.ai/v1", variable: "XAI_API_KEY" },
  {
    provider: "antigravity",
    api: "chat",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    variable: "GEMINI_API_KEY",
  },
  { provider: "inception", api: "chat", base: "https://api.inceptionlabs.ai/v1", variable: "INCEPTION_API_KEY" },
  { provider: "deepseek", api: "chat", base: "https://api.deepseek.com/v1", variable: "DEEPSEEK_API_KEY" },
  { provider: "openrouter", api: "openrouter", base: "https://openrouter.ai/api/v1", variable: "OPENROUTER_API_KEY" },
] as const satisfies readonly { provider: AgentProviderId; api: Api; base: string; variable: string }[];

export interface MemdoorModelProviderOptions {
  customProviders: CustomProviderSource;
  providerEnvironment: (provider: "claude" | "antigravity") => Readonly<Record<string, string | undefined>>;
  providerKey: (provider: AgentProviderId, variable: string) => string | undefined;
  providerOn: (provider: AgentProviderId) => boolean;
}

function apiBase(value: string): URL | null {
  const url = URL.parse(value);
  return url &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password &&
    !url.hash &&
    !url.search
    ? url
    : null;
}

export function createMemdoorModelProviders({
  customProviders,
  providerEnvironment,
  providerKey,
  providerOn,
}: MemdoorModelProviderOptions) {
  function builtins() {
    const entries = new Map<string, Connection>();
    for (const { provider, api, base: defaultBase, variable } of API_PROVIDERS) {
      if (!providerOn(provider)) continue;
      const environment = provider === "claude" || provider === "antigravity" ? providerEnvironment(provider) : {};
      const candidate = provider === "claude" ? environment.ANTHROPIC_BASE_URL || defaultBase : defaultBase;
      const base = apiBase(candidate);
      const key = environment[variable]?.trim() || providerKey(provider, variable)?.trim();
      if (key && base) entries.set(provider, { api, base: base.href.replace(/\/+$/u, ""), key });
    }
    return entries;
  }

  function custom() {
    return customProviders().flatMap((endpoint) => {
      const harness = endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
      const url = apiBase(endpoint.baseUrl);
      if (!providerOn(harness) || !url || endpoint.models.length === 0) return [];
      const anthropic = harness === "opencode" ? anthropicBaseUrl(endpoint.baseUrl) : null;
      const api: Api = anthropic ? "anthropic" : usesResponsesApi(endpoint) ? "responses" : "chat";
      return [
        {
          endpoint,
          harness,
          base: anthropic ?? url.href.replace(/\/+$/u, ""),
          api,
        },
      ];
    });
  }

  return {
    sources: () => [...builtins().keys(), ...custom().map(({ harness, endpoint }) => `${harness}:${endpoint.id}/`)],
    connection: (choice: string) => {
      const parsed = parseMemdoorModelChoice(choice);
      if (!parsed || parsed.provider === "codex") return null;
      const { provider, id } = parsed;
      const direct = builtins().get(provider);
      if (direct)
        return { ...direct, model: providerModelValue(provider === "antigravity" ? id.replace(/^models\//u, "") : id) };
      const source = memdoorModelSource(provider, id);
      if (!source) return null;
      const route = custom().find(({ endpoint, harness }) => `${harness}:${endpoint.id}/` === source);
      if (!route) return null;
      const { endpoint } = route;
      const rawId = providerModelValue(id.slice(endpoint.id.length + 1));
      const model = endpoint.models.find((candidate) => candidate.id === rawId);
      if (!model) return null;
      return {
        api: route.api,
        base: route.base,
        key: endpoint.apiKey ?? "",
        headers: Object.fromEntries(endpoint.headers.map(({ name, value }) => [name, value])),
        model: model.id,
        context: model.contextWindow,
      };
    },
  };
}

export type MemdoorModelProviders = ReturnType<typeof createMemdoorModelProviders>;
