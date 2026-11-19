import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import {
  isMemdoorTeamConfig,
  MEMDOOR_AGENT_ID,
  MEMDOOR_DECISION_MODEL,
  MEMDOOR_RUNTIME_ID,
  MEMDOOR_TEAM_MODEL,
  type MemdoorTeamConfig,
  type MemdoorTeamSettings,
  type SaveMemdoorTeamSettings,
} from "@openbot/contracts/ipc-memdoor";
import { Effect, Result, Semaphore } from "effect";
import type { CustomAgentConfig } from "../backend/custom-acp-agents-client";
import { PreferenceStore } from "./preference-file";
import type { ProviderCredentialStore } from "./provider-credential-store";

const keyName = "openbot:memdoor-openai";

export interface MemdoorTeamOptions {
  executable: string;
  profile: string;
  credentials: Pick<ProviderCredentialStore, "secret" | "setSecrets">;
  openAIEnvironment: () => Readonly<Record<string, string | undefined>>;
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

export function createMemdoorTeam({ executable, profile, credentials, openAIEnvironment }: MemdoorTeamOptions) {
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
    return endpoint && endpoint !== "https://api.openai.com/v1" ? "" : (env.OPENAI_API_KEY?.trim() ?? "");
  };
  const read = (): MemdoorTeamSettings => ({ ...settings.get(), hasApiKey: Boolean(apiKey()), runtime: runtime() });
  const save = (input: SaveMemdoorTeamSettings) =>
    writes.withPermit(
      Effect.gen(function* () {
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
  const config = (): CustomAgentConfig => {
    const { teamModel, decisionModel } = settings.get();
    const path = gitShellPath(process.platform, process.env);
    const env = {
      ...(path ? { PATH: path } : {}),
      MEMDOOR_OPENBOT_TEAM: "1",
      MEMDOOR_OPENBOT_STATE_DIR: join(profile, "memdoor", "runtime"),
      MEMDOOR_OPENBOT_ROLES_FILE: settingsPath,
      MEMDOOR_OPENBOT_DECISION_MODEL: decisionModel,
      MEMDOOR_MODEL: teamModel,
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
  return { config, load: () => settings.load(), read, save };
}

export type MemdoorTeam = ReturnType<typeof createMemdoorTeam>;

export function requireMemdoorAgentId(agentId: string): void {
  if (agentId !== MEMDOOR_AGENT_ID) throw new Error("Unknown Memdoor team.");
}
