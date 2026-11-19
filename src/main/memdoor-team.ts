import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import {
  isLegacyMemdoorTeamConfig,
  isMemdoorTeamConfig,
  MEMDOOR_AGENT_ID,
  MEMDOOR_DECISION_MODEL,
  MEMDOOR_MODEL_PATTERN,
  MEMDOOR_ROLE_IDS,
  MEMDOOR_RUNTIME_ID,
  MEMDOOR_TEAM_MODEL,
  type MemdoorTeamConfig,
  type MemdoorTeamSettings,
  type SaveMemdoorTeamSettings,
} from "@openbot/contracts/ipc-memdoor";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValues } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import type { CustomAgentConfig } from "../backend/custom-acp-agents-client";
import type { MemdoorModelProviders } from "./memdoor-model-providers";
import { PreferenceStore } from "./preference-file";
import type { ProviderCredentialStore } from "./provider-credential-store";

const keyName = "openbot:memdoor-openai";

export class MemdoorTeamClientUpdateRequired extends Error {}
export class MemdoorTeamModelUnavailable extends Error {}

class MemdoorTeamRefused extends Schema.TaggedError<MemdoorTeamRefused>()("MemdoorTeamRefused", {
  cause: Schema.Defect(),
}) {}

export interface MemdoorTeamOptions {
  executable: string;
  profile: string;
  credentials: Pick<ProviderCredentialStore, "secret" | "setSecrets">;
  openAIEnvironment: () => Readonly<Record<string, string | undefined>>;
  openAIVaultKey: () => string | undefined;
  modelProviders?: MemdoorModelProviders;
}

function gitShellPath(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string | undefined {
  if (platform !== "win32") return environment.PATH ?? "/usr/bin:/bin";
  const path = environment.PATH ?? "";
  const gitRoots = [environment.ProgramFiles, environment["ProgramFiles(x86)"], environment.LOCALAPPDATA].flatMap(
    (directory) => (directory ? [join(directory, "Git"), join(directory, "Programs", "Git")] : []),
  );
  const shell = [...gitRoots.map((root) => join(root, "usr", "bin")), ...path.split(delimiter)].find(
    (dir) => dir && existsSync(join(dir, "sh.exe")) && existsSync(join(dir, "bash.exe")),
  );
  if (!shell) return undefined;
  return [shell, join(dirname(dirname(shell)), "cmd"), path].join(delimiter);
}

export function createMemdoorTeam({
  executable,
  profile,
  credentials,
  openAIEnvironment,
  openAIVaultKey,
  modelProviders,
}: MemdoorTeamOptions) {
  const settingsPath = join(profile, "memdoor-team.json");
  const settings = new PreferenceStore<MemdoorTeamConfig>({
    path: settingsPath,
    defaultValue: { teamModel: MEMDOOR_TEAM_MODEL, decisionModel: MEMDOOR_DECISION_MODEL, roles: {} },
    decode: (value) =>
      isMemdoorTeamConfig(value)
        ? { teamModel: value.teamModel, decisionModel: value.decisionModel, roles: value.roles }
        : null,
  });
  const writes = Semaphore.makeUnsafe(1);
  const runtime = (): MemdoorTeamSettings["runtime"] =>
    !existsSync(executable) ? "missing" : gitShellPath(process.platform, process.env) ? "ready" : "git-missing";
  const apiKey = () => {
    const configured = credentials.secret(keyName);
    if (configured) return configured;
    const env = {
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ...openAIEnvironment(),
    };
    const endpoint = env.OPENAI_BASE_URL?.trim().replace(/\/+$/u, "");
    const hostKey = !endpoint || endpoint === "https://api.openai.com/v1" ? env.OPENAI_API_KEY?.trim() : undefined;
    return hostKey || openAIVaultKey()?.trim() || "";
  };
  const read = (): MemdoorTeamSettings => ({
    ...settings.get(),
    hasApiKey: Boolean(apiKey()),
    runtime: runtime(),
    modelSources: modelProviders?.sources() ?? [],
  });
  const save = (input: SaveMemdoorTeamSettings, options?: { legacyOnly?: boolean }) =>
    writes.withPermit(
      Effect.gen(function* () {
        const previous = settings.get();
        if (options?.legacyOnly && (!isLegacyMemdoorTeamConfig(previous) || !isLegacyMemdoorTeamConfig(input)))
          return yield* new MemdoorTeamRefused({ cause: new MemdoorTeamClientUpdateRequired() });
        const models = [
          [input.teamModel, previous.teamModel],
          ...MEMDOOR_ROLE_IDS.map((id) => [input.roles[id]?.model, previous.roles[id]?.model]),
        ];
        if (
          models.some(
            ([model, before]) =>
              model && model !== before && !MEMDOOR_MODEL_PATTERN.test(model) && !modelProviders?.connection(model),
          )
        )
          return yield* new MemdoorTeamRefused({
            cause: new MemdoorTeamModelUnavailable(sourceText("error.workflow.modelUnavailable")),
          });
        const previousKey = credentials.secret(keyName);
        if (input.apiKey !== undefined) yield* credentials.setSecrets([[keyName, input.apiKey]]);
        const result = yield* Effect.result(
          settings.set({ teamModel: input.teamModel, decisionModel: input.decisionModel, roles: input.roles }),
        );
        if (Result.isFailure(result)) {
          if (input.apiKey !== undefined) yield* credentials.setSecrets([[keyName, previousKey]]);
          return yield* result.failure;
        }
        return read();
      }).pipe(Effect.uninterruptible),
    );
  const selectedConnections = () => {
    const { teamModel, roles } = settings.get();
    const models = new Set([teamModel, ...Object.values(roles).map(({ model }) => model)]);
    return Object.fromEntries(
      [...models].flatMap((model) => {
        const connection = modelProviders?.connection(model);
        return connection ? [[model, connection] as const] : [];
      }),
    );
  };
  const config = (): CustomAgentConfig => {
    const { teamModel, decisionModel } = settings.get();
    const path = gitShellPath(process.platform, process.env);
    const connections = selectedConnections();
    registerSecretValues(
      Object.values(connections).flatMap(({ key, headers }) => [key, ...Object.values(headers ?? {})]),
    );
    const env = {
      ...(path ? { PATH: path } : {}),
      MEMDOOR_OPENBOT_TEAM: "1",
      MEMDOOR_OPENBOT_STATE_DIR: join(profile, "memdoor", "runtime"),
      MEMDOOR_OPENBOT_ROLES_FILE: settingsPath,
      MEMDOOR_OPENBOT_DECISION_MODEL: decisionModel,
      MEMDOOR_MODEL: teamModel,
      MEMDOOR_OPENBOT_PROVIDERS: JSON.stringify(connections),
      MEMDOOR_HOST: "127.0.0.1",
      MEMDOOR_GATEWAY: "",
      MEMDOOR_TELEMETRY_ENABLED: "0",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_API_KEY: apiKey(),
    };
    return {
      id: MEMDOOR_RUNTIME_ID,
      name: "Multi-Agent",
      command: executable,
      args: ["acp"],
      env: Object.entries(env).map(([name, value]) => ({ name, value })),
      usagePrompt: null,
    };
  };
  const connectionState = () =>
    createHash("sha256")
      .update(JSON.stringify([apiKey(), selectedConnections()]))
      .digest("hex");
  return { apiKey, connectionState, config, load: () => settings.load(), read, save };
}

export type MemdoorTeam = ReturnType<typeof createMemdoorTeam>;

export function requireMemdoorAgentId(agentId: string): void {
  if (agentId !== MEMDOOR_AGENT_ID) throw new Error("Unknown Memdoor team.");
}
