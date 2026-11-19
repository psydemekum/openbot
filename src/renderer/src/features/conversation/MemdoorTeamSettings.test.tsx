import type { AgentStatus, ClientAgentModelOption, CustomProviderSummary } from "@openbot/contracts/ipc";
import {
  MEMDOOR_AGENT_ID,
  MEMDOOR_DECISION_MODEL,
  MEMDOOR_TEAM_MODEL,
  type SaveMemdoorTeamSettings,
  type MemdoorTeamSettings as Settings,
} from "@openbot/contracts/ipc-memdoor";
import { MemdoorTeamSettings } from "@openbot/ui/features/conversation/MemdoorTeamSettings";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { expect, it, vi } from "vitest";

const status: AgentStatus = {
  phase: "ready",
  cliVersion: null,
  auth: { kind: "signed-out" },
  providers: [{ id: "codex", state: "sign-in-required", version: null, message: null }],
  capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
  message: null,
  fullAccess: true,
};

const model = (provider: ClientAgentModelOption["provider"], id: string, name: string): ClientAgentModelOption => ({
  provider,
  id,
  name,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium", "high"],
});

it("saves a configured API provider for the team and a role while keeping the decision picker on OpenAI", async () => {
  const settings: Settings = {
    teamModel: MEMDOOR_TEAM_MODEL,
    decisionModel: MEMDOOR_DECISION_MODEL,
    roles: { review: { model: "claude:claude-sonnet-4-6", effort: "", prompt: "Keep the review instructions." } },
    hasApiKey: true,
    runtime: "ready",
    modelSources: ["claude", "openrouter"],
  };
  const save = vi.fn(async (input: SaveMemdoorTeamSettings) => ({ ...settings, ...input }));
  render(() => (
    <MemdoorTeamSettings
      agentId={MEMDOOR_AGENT_ID}
      agentStatus={status}
      modelOptions={[
        model("codex", MEMDOOR_TEAM_MODEL, "GPT-6.2 Sol"),
        model("codex", MEMDOOR_DECISION_MODEL, "GPT-6 Luna"),
        model("claude", "claude-sonnet-4-6", "Claude Sonnet"),
        model("openrouter", "claude-sonnet-4-6", "Claude Sonnet via OpenRouter"),
        model("grok", "grok-4", "Grok 4"),
      ]}
      read={async () => settings}
      save={save}
    />
  ));

  const brain = within(await screen.findByRole("region", { name: "Brain" }));
  fireEvent.click(brain.getByRole("button", { name: /^Decision model: GPT-6 Luna$/u }));
  await screen.findByRole("option", { name: /GPT-6 Luna/u });
  expect(screen.queryByRole("tab", { name: /Claude|OpenRouter|Grok/u })).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  fireEvent.click(brain.getByRole("button", { name: /^Default team model: GPT-6\.2 Sol$/u }));
  fireEvent.click(await screen.findByRole("tab", { name: /^Claude/u }));
  expect(screen.queryByRole("tab", { name: /Grok/u })).toBeNull();
  fireEvent.click(await screen.findByRole("option", { name: "Claude Sonnet" }));
  await brain.findByRole("button", { name: /^Default team model: Claude Sonnet$/u });

  fireEvent.click(brain.getByRole("button", { name: /^Plan: Claude Sonnet$/u }));
  fireEvent.click(await screen.findByRole("tab", { name: /^OpenRouter/u }));
  fireEvent.click(await screen.findByRole("option", { name: "Claude Sonnet via OpenRouter" }));
  await brain.findByRole("button", { name: /^Plan: Claude Sonnet via OpenRouter$/u });

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledWith({
    agentId: MEMDOOR_AGENT_ID,
    teamModel: "claude:claude-sonnet-4-6",
    decisionModel: MEMDOOR_DECISION_MODEL,
    roles: {
      ...settings.roles,
      plan: { model: "openrouter:claude-sonnet-4-6", effort: "", prompt: "" },
    },
  });
});

it("lists configured custom endpoint models and retains a saved choice if the endpoint is removed", async () => {
  let settings: Settings = {
    teamModel: MEMDOOR_TEAM_MODEL,
    decisionModel: MEMDOOR_DECISION_MODEL,
    roles: {},
    hasApiKey: true,
    runtime: "ready",
    modelSources: ["opencode:team-local/"],
  };
  const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>([
    {
      id: "team-local",
      name: "Team endpoint",
      baseUrl: "http://localhost:8000/v1",
      hasApiKey: false,
      models: [{ id: "example/chat", name: "Team Chat" }],
    },
  ]);
  const save = vi.fn(async (input: SaveMemdoorTeamSettings) => {
    settings = { ...settings, ...input };
    return settings;
  });
  render(() => (
    <MemdoorTeamSettings
      agentId={MEMDOOR_AGENT_ID}
      agentStatus={status}
      modelOptions={[
        model("codex", MEMDOOR_TEAM_MODEL, "GPT-6.2 Sol"),
        model("opencode", "team-local/stale", "Stale model"),
        model("opencode", "team-local-preview/preview-model", "Preview model"),
      ]}
      customProviders={customProviders()}
      read={async () => settings}
      save={save}
    />
  ));

  fireEvent.click(await screen.findByRole("button", { name: /^Plan: GPT-6\.2 Sol$/u }));
  fireEvent.click(await screen.findByRole("tab", { name: /^Custom/u }));
  const models = within(await screen.findByRole("tabpanel", { name: /Custom/u }));
  const options = await models.findAllByRole("option");
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveAccessibleName("Team Chat");
  fireEvent.click(models.getByRole("option", { name: "Team Chat" }));
  await screen.findByRole("button", { name: /^Plan: Team endpoint\/Team Chat$/u });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(save).toHaveBeenCalledWith({
    agentId: MEMDOOR_AGENT_ID,
    teamModel: MEMDOOR_TEAM_MODEL,
    decisionModel: MEMDOOR_DECISION_MODEL,
    roles: { plan: { model: "opencode:team-local/example/chat", effort: "", prompt: "" } },
  });

  await screen.findByText("Memdoor team settings saved.");
  settings = { ...settings, modelSources: [] };
  setCustomProviders([]);
  const retained = await screen.findByRole("button", { name: /^Plan: team-local\/example\/chat$/u });
  await vi.waitFor(() => expect(retained).toBeEnabled());
  fireEvent.click(retained);
  await screen.findByRole("option", { name: "GPT-6.2 Sol" });
  expect(screen.queryByRole("tab", { name: /Custom|OpenCode/u })).toBeNull();
});

it("uses the compatible OpenBot model list for each internal role and saves only the changed role", async () => {
  const settings: Settings = {
    teamModel: MEMDOOR_TEAM_MODEL,
    decisionModel: MEMDOOR_DECISION_MODEL,
    roles: { review: { model: "gpt-6-saved", effort: "high", prompt: "Keep the review instructions." } },
    hasApiKey: true,
    runtime: "ready",
  };
  const save = vi.fn(async (input: SaveMemdoorTeamSettings) => ({ ...settings, roles: input.roles }));
  render(() => (
    <MemdoorTeamSettings
      agentId={MEMDOOR_AGENT_ID}
      agentStatus={status}
      modelOptions={[
        model("codex", MEMDOOR_TEAM_MODEL, "GPT-6.2 Sol"),
        model("codex", "gpt-6.1-terra", "GPT-6.1 Terra"),
        model("claude", "claude-sonnet-4-6", "Claude Sonnet"),
      ]}
      read={async () => settings}
      save={save}
    />
  ));

  const brain = within(await screen.findByRole("region", { name: "Brain" }));
  const planner = brain.getByRole("button", { name: /^Plan: GPT-6\.2 Sol$/u });
  expect(brain.getAllByRole("button", { name: /: (?:GPT-6\.2 Sol|gpt-6-saved|gpt-6-luna)$/u })).toHaveLength(12);
  fireEvent.click(planner);
  const alternative = await screen.findByRole("option", { name: "GPT-6.1 Terra" });
  expect(screen.queryByRole("tab", { name: /Claude/u })).toBeNull();
  expect(alternative).toBeEnabled();
  fireEvent.click(alternative);
  await screen.findByRole("button", { name: /^Plan: GPT-6\.1 Terra$/u });
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledWith({
    agentId: MEMDOOR_AGENT_ID,
    teamModel: MEMDOOR_TEAM_MODEL,
    decisionModel: MEMDOOR_DECISION_MODEL,
    roles: {
      ...settings.roles,
      plan: { model: "gpt-6.1-terra", effort: "", prompt: "" },
    },
  });
});
