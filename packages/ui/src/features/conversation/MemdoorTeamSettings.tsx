import {
  isMemdoorTeamConfig,
  isSaveMemdoorTeamSettings,
  MEMDOOR_EFFORTS,
  MEMDOOR_PROMPT_LIMIT,
  MEMDOOR_ROLE_IDS,
  type MemdoorRole,
  type MemdoorRoleId,
  type MemdoorTeamConfig,
  type SaveMemdoorTeamSettings,
  type MemdoorTeamSettings as Settings,
} from "@openbot/contracts/ipc-memdoor";
import { Button, Field, Input, NativeSelect, Text, Textarea } from "@openbot/ui";
import { SettingsLinkGroup } from "@openbot/ui/components/SettingsPanel";
import { createEffect, createStore, For, Show } from "solid-js";
import { useText } from "../../text";

const EMPTY_ROLE: MemdoorRole = { model: "", effort: "", prompt: "" };
const MODEL_MAX_LENGTH = 84;

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
  read: () => Promise<Settings>;
  save: (input: SaveMemdoorTeamSettings) => Promise<Settings>;
  allowApiKey?: boolean;
}) {
  const { t } = useText();
  const [state, setState] = createStore<PanelState>({ ...INITIAL_STATE });
  let generation = 0;
  const busy = () => state.pending !== null;
  const hasChanges = () => state.dirty || (props.allowApiKey === true && state.apiKey.trim() !== "");

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
            <Field label={t("agentSettings.memdoor.teamModel")} required>
              <Input
                value={draft().teamModel}
                maxlength={MODEL_MAX_LENGTH}
                disabled={busy()}
                onValueChange={(value) =>
                  editDraft((next) => {
                    next.teamModel = value;
                  })
                }
              />
            </Field>
            <Field label={t("agentSettings.memdoor.decisionModel")} required>
              <Input
                value={draft().decisionModel}
                maxlength={MODEL_MAX_LENGTH}
                disabled={busy()}
                onValueChange={(value) =>
                  editDraft((next) => {
                    next.decisionModel = value;
                  })
                }
              />
            </Field>
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
            <For each={MEMDOOR_ROLE_IDS}>
              {(id) => {
                const role = () => draft().roles[id] ?? EMPTY_ROLE;
                return (
                  <details>
                    <summary class="cursor-pointer py-1">{t(ROLE_LABEL[id])}</summary>
                    <SettingsLinkGroup class="agent-settings-page">
                      <Field label={t("agentSettings.memdoor.roleModel")}>
                        <Input
                          value={role().model}
                          placeholder={t("agentSettings.memdoor.inheritModel")}
                          maxlength={MODEL_MAX_LENGTH}
                          disabled={busy()}
                          onValueChange={(model) => editRole(id, { model })}
                        />
                      </Field>
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
                  </details>
                );
              }}
            </For>
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
