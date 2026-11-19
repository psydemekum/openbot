import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { MEMDOOR_AGENT_ID, MEMDOOR_DECISION_MODEL, MEMDOOR_TEAM_MODEL } from "@openbot/contracts/ipc-memdoor";
import { Effect } from "effect";
import { createMemdoorTeam } from "../src/main/memdoor-team";

const profile = await mkdtemp(join(tmpdir(), "openbot-memdoor-e2e-"));
try {
  const executable = resolve("build/memdoor", process.platform === "win32" ? "memdoor.exe" : "memdoor");
  const secrets = new Map<string, string>();
  const providerKey = "sk-fixture-provider";
  const teamKey = "sk-fixture-team";
  const teamOptions = {
    executable,
    profile,
    credentials: {
      secret: (name: string) => secrets.get(name) ?? null,
      setSecrets: (entries: ReadonlyArray<readonly [string, string | null]>) =>
        Effect.sync(() => {
          for (const [name, value] of entries) {
            if (value === null) secrets.delete(name);
            else secrets.set(name, value);
          }
        }),
    },
    openAIEnvironment: () => ({ OPENAI_API_KEY: providerKey, OPENAI_BASE_URL: "https://api.openai.com/v1" }),
    openAIVaultKey: () => "sk-fixture-vault",
  };
  const team = createMemdoorTeam(teamOptions);
  await Effect.runPromise(team.load());
  assert.equal(team.read().teamModel, MEMDOOR_TEAM_MODEL);
  assert.equal(team.read().decisionModel, MEMDOOR_DECISION_MODEL);
  assert.equal(team.read().hasApiKey, true);
  assert.equal(team.config().env.find(({ name }) => name === "OPENAI_API_KEY")?.value, providerKey);
  const vaultTeam = createMemdoorTeam({
    ...teamOptions,
    openAIEnvironment: () => ({ OPENAI_API_KEY: providerKey, OPENAI_BASE_URL: "https://example.invalid/v1" }),
  });
  assert.equal(vaultTeam.apiKey(), "sk-fixture-vault");
  const saved = await Effect.runPromise(
    team.save({
      agentId: MEMDOOR_AGENT_ID,
      teamModel: MEMDOOR_TEAM_MODEL,
      decisionModel: MEMDOOR_DECISION_MODEL,
      roles: { review: { model: "", effort: "high", prompt: "Prüfe Änderungen.\n  Erhalte die Einrückung." } },
      apiKey: teamKey,
    }),
  );
  assert.equal(team.config().env.find(({ name }) => name === "OPENAI_API_KEY")?.value, teamKey);
  const state = await readFile(join(profile, "memdoor-team.json"), "utf8");
  assert.equal(JSON.parse(state).version, 1);
  assert.ok(!state.includes(teamKey) && !JSON.stringify(saved).includes(teamKey));
  const restarted = createMemdoorTeam(teamOptions);
  await Effect.runPromise(restarted.load());
  assert.deepEqual(restarted.read(), saved);

  const config = restarted.config();
  const worker = spawn(executable, config.args, {
    cwd: profile,
    env: {
      ...process.env,
      ...Object.fromEntries(config.env.map(({ name, value }) => [name, value])),
      OPENAI_API_KEY: "",
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const closed = once(worker, "close");
  closed.catch(() => {});
  const lines = createInterface({ input: worker.stdout, crlfDelay: Infinity });
  const stream = lines[Symbol.asyncIterator]();
  const timeout = setTimeout(() => worker.kill(), 15_000);
  type SmokeParams =
    | { protocolVersion: number; clientCapabilities: Record<never, never> }
    | { cwd: string; mcpServers: never[] }
    | { sessionId: string; prompt: { type: "text"; text: string }[] };
  async function request(id: number, method: string, params: SmokeParams) {
    worker.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    for (;;) {
      const line = await stream.next();
      assert.ok(!line.done, `Memdoor exited before answering ${method}`);
      const frame = JSON.parse(line.value);
      if (frame.id === id) return frame;
    }
  }
  try {
    const initialization = await request(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
    assert.equal(initialization.result.agentInfo.name, "memdoor");
    const session = await request(2, "session/new", { cwd: profile, mcpServers: [] });
    assert.match(session.result.sessionId, /^memdoor-/u);
    const turn = await request(3, "session/prompt", {
      sessionId: session.result.sessionId,
      prompt: [{ type: "text", text: "Check the missing credential." }],
    });
    assert.ok(turn.error, "A missing key must fail the ACP turn instead of completing it.");
    assert.match(JSON.stringify(turn.error), /OpenAI API key/u);
  } finally {
    worker.stdin.end();
    try {
      await closed;
    } finally {
      clearTimeout(timeout);
      lines.close();
    }
  }
  process.stdout.write(
    "Memdoor settings persist without the key, and the native ACP runtime handles missing credentials.\n",
  );
} finally {
  await rm(profile, { recursive: true, maxRetries: 5, retryDelay: 200 });
}
