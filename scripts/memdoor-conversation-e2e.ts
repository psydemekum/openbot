import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { MEMDOOR_AGENT_ID, MEMDOOR_RUNTIME_ID } from "@openbot/contracts/ipc-memdoor";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { readJsonl } from "./provider-fakes/host";

// On Windows, Bun releases SQLite's profile handles when the test process exits.
const workerProfile = process.env.OPENBOT_MEMDOOR_E2E_PROFILE;
if (!workerProfile) {
  const profile = await mkdtemp(join(tmpdir(), "openbot-memdoor-conversation-"));
  try {
    const test = spawnSync(process.execPath, [import.meta.filename], {
      env: { ...process.env, OPENBOT_MEMDOOR_E2E_PROFILE: profile },
      stdio: "inherit",
    });
    if (test.error) throw test.error;
    process.exitCode = test.status ?? 1;
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  process.exit(process.exitCode);
}
const root = workerProfile;
const log = join(root, "turns.jsonl");
const agentId = MEMDOOR_AGENT_ID;
const unused = () => Effect.die(new Error("Unexpected browser operation."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => {},
  unshareThread: () => {},
  agentTab: () => null,
};

async function open() {
  const data = join(root, "data");
  const database = new OpenBotDatabase(data);
  const store = new AgentStore(data, join(root, "home"), database);
  const mailbox = new MailboxStore(data, store.sharedRoot, database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "acp",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "acp"),
    credentials: {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [],
      customAgents: () => [
        {
          id: MEMDOOR_RUNTIME_ID,
          name: "Memdoor",
          command: process.execPath,
          args: [resolve(import.meta.dirname, "provider-fakes/agents/memdoor.ts")],
          env: [{ name: "FAKE_LOG", value: log }],
          usagePrompt: null,
        },
      ],
    },
  });
  await runCauseEffect(service.initialize());
  await runCauseEffect(store.ensureMemdoorAgent());
  return { service, database };
}

interface Turn {
  sessionId: string;
  text: string;
  answer: string;
}
async function waitForTurn(text: string): Promise<Turn> {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const deliveries = host.service.listQueue(agentId).deliveries;
    const failed = deliveries.find((one) => one.status === "failed");
    assert.ok(!failed, failed?.error ?? "A delivery failed.");
    const turn = (await readJsonl<Turn>(log)).findLast((entry) => entry.text.includes(text));
    if (turn && deliveries.every(({ status }) => !["starting", "running", "queued"].includes(status))) return turn;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for the delivery of ${text}.`);
}
async function send(text: string, taskId?: string) {
  await runCauseEffect(host.service.sendMessage({ agentId, text, ...(taskId ? { taskId } : {}) }));
  return waitForTurn(text);
}
async function close() {
  await runCauseEffect(host.service.stop());
  host.database.close();
}

let host = await open();
try {
  const first = await send("Remember the name Alpenrose.");
  const next = await send("Recall the name and your answer.");
  assert.equal(next.sessionId, first.sessionId);
  assert.ok(next.text.includes("Remember the name Alpenrose.") && next.text.includes(first.answer));
  assert.equal(next.text.split("Recall the name and your answer.").length, 2);

  const separate = "Remember the name Lindenbaum.";
  const task = await runCauseEffect(host.service.startTask({ agentId, text: separate }));
  const side = await waitForTurn(separate);
  assert.ok(!side.text.includes("Alpenrose") && !side.text.includes(first.answer));
  const sideFollowup = await send("What name was in this thread?", task.id);
  assert.ok(sideFollowup.text.includes(separate) && sideFollowup.text.includes(side.answer));
  assert.ok(!sideFollowup.text.includes("Alpenrose"));

  const instruction = "Report the routine marker.";
  const routine = host.service.createRoutine({
    agentId,
    name: "Conversation E2E",
    instruction,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(host.service.testRoutine({ agentId, routineId: routine.id }));
  const run = await waitForTurn(instruction);
  assert.ok(run.text.includes("This routine run has its own session."));
  assert.ok(!run.text.includes("Previous conversation excerpts.") && !run.text.includes(separate));
  const afterRoutine = await send("Continue in the original chat.");
  assert.ok(afterRoutine.text.includes(first.answer) && afterRoutine.text.includes(run.answer));
  assert.ok(!afterRoutine.text.includes(separate));
  const predecessor = "Workflow input from the previous step.";
  await runCauseEffect(
    host.service.enqueueRoutineHandoff({
      agentId,
      run: {
        id: "workflow-run-1",
        routineId: "workflow-1",
        routineName: "Process this input",
        scheduledFor: new Date().toISOString(),
      },
      text: predecessor,
      idempotencyKey: "workflow-step:memdoor-e2e",
    }),
  );
  const step = await waitForTurn(predecessor);
  assert.ok(!step.text.includes("Alpenrose") && !step.text.includes("Lindenbaum"));
  assert.ok(!step.text.includes(first.answer) && !step.text.includes(afterRoutine.answer));

  await close();
  host = await open();
  const resumed = await send("Continue after restart.");
  assert.notEqual(resumed.sessionId, next.sessionId);
  assert.ok(resumed.text.includes("Alpenrose") && resumed.text.includes(next.answer));
  assert.equal(resumed.text.split("Previous conversation excerpts.").length, 2);
  assert.ok(!resumed.text.includes(separate) && !resumed.text.includes(side.answer));

  await runCauseEffect(host.service.clearAgentContext(agentId));
  const reset = await send("Start fresh.");
  assert.ok(!reset.text.includes("Alpenrose") && !reset.text.includes(next.answer));
  const long = await send(`Beginning of the long message. ${"detail ".repeat(7000)} End of the long message.`);
  const bounded = await send("Summarize the long message.");
  const history = bounded.text.split("--- current message ---")[0] ?? "";
  assert.ok(history.length <= 32_000);
  assert.ok(history.includes("Beginning of the long message.") && history.includes("End of the long message."));
  assert.ok(history.includes(long.answer));
  const out = resolve(import.meta.dirname, "../.openbot-build/memdoor-conversation-e2e");
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checked: [
          "same session",
          "separate threads",
          "routine",
          "workflow handoff",
          "restart",
          "new chat",
          "bounded history",
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write("Memdoor conversation replay passed.\n");
} finally {
  await close();
}
