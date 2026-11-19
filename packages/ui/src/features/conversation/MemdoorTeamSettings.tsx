import type { AgentStatus, ClientAgentModelOption } from "@openbot/contracts/ipc";
import {
  isMemdoorTeamConfig,
  isSaveMemdoorTeamSettings,
  MEMDOOR_EFFORTS,
  MEMDOOR_MODEL_PATTERN,
  MEMDOOR_PROMPT_LIMIT,
  MEMDOOR_ROLE_IDS,
  type MemdoorRole,
  type MemdoorRoleId,
  type MemdoorTeamConfig,
  type SaveMemdoorTeamSettings,
  type MemdoorTeamSettings as Settings,
} from "@openbot/contracts/ipc-memdoor";
import { Button, Field, Input, NativeSelect, Text, Textarea } from "@openbot/ui";
import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import { SettingsLinkGroup } from "@openbot/ui/components/SettingsPanel";
import { createEffect, createMemo, createStore, For, Show } from "solid-js";
import { useText } from "../../text";

const EMPTY_ROLE: MemdoorRole = { model: "", effort: "", prompt: "" };

const ROLE_LABEL = {
  reproduce: "agentSettings.memdoor.role.reproduce",
  "direct-a": "agentSettings.memdoor.role.directA",
  "direct-b": "agentSettings.memdoor.role.directB",
  "direct-c": "agentSettings.memdoor.role.directC",
  ideate: "agentSettings.memdoor.role.ideate",
  plan: "agentSettings.memdoor.role.plan",
  solve: "agentSettings.memdoor.role.solve",
  judge: "agentSettings.memdoor.role.judge",
  review: "agentSettings.memdoor.role.review",
  repair: "agentSettings.memdoor.role.repair",
} as const satisfies Record<MemdoorRoleId, string>;

const EFFORT_LABEL = {
  "": "agentSettings.memdoor.inheritEffort",
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
} as const satisfies Record<MemdoorRole["effort"], string>;

const RUNTIME_LABEL = {
  ready: "agentSettings.memdoor.runtime.ready",
  missing: "agentSettings.memdoor.runtime.missing",
  "git-missing": "agentSettings.memdoor.runtime.gitMissing",
} as const satisfies Record<Settings["runtime"], string>;

interface PanelState {
  status: Pick<Settings, "runtime" | "hasApiKey"> | null;
  draft: MemdoorTeamConfig | null;
  apiKey: string;
  dirty: boolean;
  pending: "loading" | "saving" | null;
  loadError: string | null;
  saveError: string | null;
  saved: boolean;
}

const INITIAL_STATE: PanelState = {
  status: null,
  draft: null,
  apiKey: "",
  dirty: false,
  pending: "loading",
  loadError: null,
  saveError: null,
  saved: false,
};

function draftFrom(settings: Settings): MemdoorTeamConfig {
  const roles: MemdoorTeamConfig["roles"] = {};
  for (const id of MEMDOOR_ROLE_IDS) {
    const role = settings.roles[id];
    if (role) roles[id] = { ...role };
  }
  return { teamModel: settings.teamModel, decisionModel: settings.decisionModel, roles };
}

export function MemdoorTeamSettings(props: {
  agentId: string;
  agentStatus: AgentStatus;
  modelOptions: ClientAgentModelOption[];
  read: () => Promise<Settings>;
  save: (input: SaveMemdoorTeamSettings) => Promise<Settings>;
  allowApiKey?: boolean;
}) {
  const { t } = useText();
  const [state, setState] = createStore<PanelState>({ ...INITIAL_STATE });
  let generation = 0;
  const busy = () => state.pending !== null;
  const hasChanges = () => state.dirty || (props.allowApiKey === true && state.apiKey.trim() !== "");
  const models = createMemo(() =>
    props.modelOptions.filter((model) => model.provider === "codex" && MEMDOOR_MODEL_PATTERN.test(model.id)),
  );
  // Memdoor sends requests with its own OpenAI credential, independent of the Codex CLI session.
  const modelStatus = createMemo<AgentStatus>(() => ({ ...props.agentStatus, phase: "ready", providers: undefined }));

  function ModelSetting(choice: { label: string; value: string; select: (id: string) => void }) {
    return (
      <ProviderModelPicker
        variant="field"
        onlyProvider="codex"
        provider="codex"
        value={choice.value}
        label={choice.label}
        ariaLabel={choice.label}
        modelOptions={models()}
        agentStatus={modelStatus()}
        disabled={busy() || models().length === 0}
        disabledReason={t("agentSettings.memdoor.noModels")}
        onChange={choice.select}
      />
    );
  }

  async function load(read: typeof props.read, current: number) {
    setState((s) => {
      s.pending = "loading";
      s.loadError = null;
      s.saved = false;
    });
    try {
      const settings = await read();
      if (current !== generation) return;
      setState((s) => {
        s.status = { runtime: settings.runtime, hasApiKey: settings.hasApiKey };
        if (!s.dirty) s.draft = draftFrom(settings);
      });
    } catch {
      if (current === generation) {
        setState((s) => {
          s.loadError = t("agentSettings.memdoor.loadFailed");
        });
      }
    } finally {
      if (current === generation) {
        setState((s) => {
          s.pending = null;
        });
      }
    }
  }

  createEffect(
    () => [props.agentId, props.read, props.allowApiKey] as const,
    ([, read]) => {
      const current = ++generation;
      setState(() => ({ ...INITIAL_STATE }));
      void load(read, current);
      return () => {
        generation += 1;
      };
    },
  );

  function editDraft(edit: (draft: MemdoorTeamConfig) => void) {
    if (busy()) return;
    setState((s) => {
      if (!s.draft) return;
      edit(s.draft);
      s.dirty = true;
      s.saveError = null;
      s.saved = false;
    });
  }

  function editRole(id: MemdoorRoleId, values: Partial<MemdoorRole>) {
    editDraft((draft) => {
      draft.roles[id] = { ...(draft.roles[id] ?? EMPTY_ROLE), ...values };
    });
  }

  async function save() {
    const draft = state.draft;
    if (!draft || busy() || !hasChanges()) return;
    const roles: MemdoorTeamConfig["roles"] = {};
    for (const id of MEMDOOR_ROLE_IDS) {
      const role = draft.roles[id];
      if (!role) continue;
      const model = role.model.trim();
      if (model || role.effort || role.prompt) roles[id] = { model, effort: role.effort, prompt: role.prompt };
    }
    const apiKey = props.allowApiKey ? state.apiKey.trim() : "";
    const input: SaveMemdoorTeamSettings = {
      agentId: props.agentId,
      teamModel: draft.teamModel.trim(),
      decisionModel: draft.decisionModel.trim(),
      roles,
      ...(apiKey ? { apiKey } : {}),
    };
    if (!isSaveMemdoorTeamSettings(input)) {
      setState((s) => {
        s.saveError = !isMemdoorTeamConfig(input)
          ? t("agentSettings.memdoor.invalidModels")
          : apiKey
            ? t("agentSettings.memdoor.invalidKey")
            : t("agentSettings.saveFailed");
      });
      return;
    }

    const current = generation;
    setState((s) => {
      s.pending = "saving";
      s.saveError = null;
    });
    try {
      const settings = await props.save(input);
      if (current !== generation) return;
      setState((s) => {
        s.status = { runtime: settings.runtime, hasApiKey: settings.hasApiKey };
        s.draft = draftFrom(settings);
        s.apiKey = "";
        s.dirty = false;
        s.saved = true;
      });
    } catch {
      if (current === generation) {
        setState((s) => {
          s.saveError = t("agentSettings.saveFailed");
        });
      }
    } finally {
      if (current === generation) {
        setState((s) => {
          s.pending = null;
        });
      }
    }
  }

  return (
    <div class="agent-settings-page">
      <SettingsLinkGroup inset title={t("agentSettings.memdoor.title")}>
        <div class="agent-session-setting-notes" aria-busy={state.pending === "loading" ? "true" : undefined}>
          <Show when={state.status}>
            {(status) => (
              <>
                <Text tone="muted">{t(RUNTIME_LABEL[status().runtime])}</Text>
                <Text tone="muted">
                  {status().hasApiKey ? t("agentSettings.memdoor.keySet") : t("agentSettings.memdoor.keyMissing")}
                </Text>
              </>
            )}
          </Show>
          <Show
            when={state.pending === "loading"}
            fallback={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load(props.read, generation)}
                disabled={busy()}
              >
                {state.status ? t("agentSettings.memdoor.refresh") : t("common.retry")}
              </Button>
            }
          >
            <Text role="status" tone="muted">
              {t("common.loading")}
            </Text>
          </Show>
          <Show when={state.loadError}>{(error) => <Text role="alert">{error()}</Text>}</Show>
        </div>
      </SettingsLinkGroup>
      <Show when={state.draft}>
        {(draft) => (
          <>
            <SettingsLinkGroup inset class="agent-settings-runtime-rows" title={t("agentSettings.groups.brain")}>
              <ModelSetting
                label={t("agentSettings.memdoor.teamModel")}
                value={draft().teamModel}
                select={(value) =>
                  editDraft((next) => {
                    next.teamModel = value;
                  })
                }
              />
              <ModelSetting
                label={t("agentSettings.memdoor.decisionModel")}
                value={draft().decisionModel}
                select={(value) =>
                  editDraft((next) => {
                    next.decisionModel = value;
                  })
                }
              />
              <For each={MEMDOOR_ROLE_IDS}>
                {(id) => (
                  <ModelSetting
                    label={t(ROLE_LABEL[id])}
                    value={draft().roles[id]?.model || draft().teamModel}
                    select={(model) => editRole(id, { model })}
                  />
                )}
              </For>
            </SettingsLinkGroup>
            <Show when={models().length === 0}>
              <Text tone="muted">{t("agentSettings.memdoor.noModels")}</Text>
            </Show>
            <Show when={props.allowApiKey}>
              <Field label={t("agentSettings.memdoor.newKey")} description={t("agentSettings.memdoor.keepKey")}>
                <Input
                  type="password"
                  autocomplete="new-password"
                  value={state.apiKey}
                  maxlength={4096}
                  disabled={busy()}
                  onValueChange={(value) =>
                    setState((s) => {
                      s.apiKey = value;
                      s.saveError = null;
                      s.saved = false;
                    })
                  }
                />
              </Field>
            </Show>
            <details>
              <summary class="cursor-pointer py-1">{t("agentSettings.memdoor.roleOptions")}</summary>
              <For each={MEMDOOR_ROLE_IDS}>
                {(id) => {
                  const role = () => draft().roles[id] ?? EMPTY_ROLE;
                  return (
                    <SettingsLinkGroup class="agent-settings-page" title={t(ROLE_LABEL[id])}>
                      <Show when={role().model}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy()}
                          onClick={() => editRole(id, { model: "" })}
                        >
                          {t("agentSettings.memdoor.inheritModel")}
                        </Button>
                      </Show>
                      <Field label={t("agentSettings.memdoor.roleEffort")}>
                        <NativeSelect
                          value={role().effort}
                          disabled={busy()}
                          onChange={(event) => {
                            const effort = MEMDOOR_EFFORTS.find((choice) => choice === event.currentTarget.value);
                            if (effort !== undefined) editRole(id, { effort });
                          }}
                        >
                          <For each={MEMDOOR_EFFORTS}>
                            {(effort) => <option value={effort}>{t(EFFORT_LABEL[effort])}</option>}
                          </For>
                        </NativeSelect>
                      </Field>
                      <Field label={t("agentSettings.memdoor.rolePrompt")}>
                        <Textarea
                          value={role().prompt}
                          maxlength={MEMDOOR_PROMPT_LIMIT}
                          rows={3}
                          disabled={busy()}
                          onValueChange={(prompt) => editRole(id, { prompt })}
                        />
                      </Field>
                    </SettingsLinkGroup>
                  );
                }}
              </For>
            </details>
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy() || !hasChanges()}>
              {state.pending === "saving" ? t("common.saving") : t("common.save")}
            </Button>
            <Show when={state.saved}>
              <Text role="status" tone="muted">
                {t("agentSettings.memdoor.saved")}
              </Text>
            </Show>
            <Show when={state.saveError}>{(error) => <Text role="alert">{error()}</Text>}</Show>
          </>
        )}
      </Show>
    </div>
  );
}
