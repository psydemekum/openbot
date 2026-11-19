import type { AgentStatus, ClientAgentModelOption } from "@openbot/contracts/ipc";
import {
  MEMDOOR_AGENT_ID,
  MEMDOOR_DECISION_MODEL,
  MEMDOOR_TEAM_MODEL,
  type SaveMemdoorTeamSettings,
  type MemdoorTeamSettings as Settings,
} from "@openbot/contracts/ipc-memdoor";
import { MemdoorTeamSettings } from "@openbot/ui/features/conversation/MemdoorTeamSettings";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
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
