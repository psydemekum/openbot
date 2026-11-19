import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { MEMDOOR_AGENT_ID } from "@openbot/contracts/ipc-memdoor";
import { chromium } from "playwright-core";
import { grantWorkflowExportFolder } from "../src/backend/workflows/file-storage";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const [port, rootArgument] = process.argv.slice(2);
assert.ok(port && /^\d+$/u.test(port) && rootArgument, "Pass the test app's loopback CDP port and temporary root.");
const root = await realpath(rootArgument);
assert.equal(dirname(root), await realpath(tmpdir()));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);

async function until<T>(label: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function task(prefix: string) {
  const a = randomInt(11, 98);
  const b = randomInt(11, 98);
  return {
    text: `Multiply ${a} by ${b}. Reply with the single line ${prefix}- followed immediately by the decimal product.`,
    expected: `${prefix}-${a * b}`,
  };
}

try {
  const page = await until("OpenBot renderer", async () => {
    for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
      if (!candidate.url().split("?")[0]?.endsWith("/index.html")) continue;
      if (await candidate.evaluate(() => Boolean(window.openbot?.agent)).catch(() => false)) return candidate;
    }
  });
  const agent = await page.evaluate(
    async (id) => (await window.openbot.agent.listAgents()).find((a) => a.id === id),
    MEMDOOR_AGENT_ID,
  );
  assert.ok(agent);
  assert.equal(
    await realpath(agent.workspacePath),
    await realpath(join(root, "home", "OpenBot", "Agents", MEMDOOR_AGENT_ID)),
  );
  const chat = task("CHAT");
  const previous = await page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
  const known = new Set(previous.messages.map((message) => message.id));
  await page.evaluate((input) => window.openbot.agent.sendMessage(input), { agentId: agent.id, text: chat.text });
  const final = await until("assistant chat answer", async () => {
    const state = await page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
    const fresh = state.messages.filter((message) => !known.has(message.id));
    assert.ok(
      !fresh.some((message) => message.status === "failed" || message.status === "interrupted"),
      "The chat turn failed.",
    );
    return fresh.find(
      (message) =>
        message.author === "assistant" && message.status === "completed" && message.itemType === "final_answer",
    );
  });
  assert.equal(final.text.trim(), chat.expected);
  const rendered = page.locator("[data-selection-message-id]").filter({ hasText: chat.expected }).last();
  await rendered.waitFor({ state: "visible" });
  const out = resolve(import.meta.dir, "../.openbot-build/memdoor-delivery-live");
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: join(out, "chat.png") });
  process.stdout.write(`Chat delivered ${chat.expected}\n`);

  const transfer = task("FLOW");
  const workflow = await page.evaluate(() => window.openbot.workflows.create({ title: "Memdoor live delivery" }));
  const exportDirectory = join(root, randomUUID());
  await mkdir(exportDirectory);
  const folder = await grantWorkflowExportFolder(
    join(root, "profile"),
    { workflowId: workflow.summary.id, nodeId: "file" },
    exportDirectory,
  );
  const saved = await page.evaluate(
    ({ id, revision, agentId, text, folder }) =>
      window.openbot.workflows.saveGraph({
        workflowId: id,
        baseRevision: revision,
        graph: {
          nodes: [
            { id: "input", kind: "prompt", at: { x: 0, y: 0 }, fields: { text } },
            {
              id: "team",
              kind: "agent",
              at: { x: 230, y: 0 },
              fields: { agentId, task: "Answer the supplied request." },
            },
            {
              id: "file",
              kind: "output",
              at: { x: 460, y: 0 },
              fields: {
                target: "file",
                format: "txt",
                filename: "handoff",
                folderGrantId: folder.id,
                folderName: folder.name,
              },
            },
          ],
          edges: [
            { id: "request", from: "input", to: "team", type: "text" },
            { id: "answer", from: "team", to: "file", type: "text" },
          ],
          strokes: [],
        },
      }),
    { id: workflow.summary.id, revision: workflow.revision, agentId: agent.id, text: transfer.text, folder },
  );
  assert.ok(saved.ok);
  const started = await page.evaluate((input) => window.openbot.workflows.startRun(input), {
    workflowId: workflow.summary.id,
    requestId: randomUUID(),
  });
  const complete = await until("workflow file output", async () => {
    const detail = await page.evaluate((id) => window.openbot.workflows.run(id), started.run.id);
    assert.ok(
      detail.run.status !== "failed" && detail.run.status !== "stopped",
      detail.run.error ?? "The workflow stopped.",
    );
    return detail.run.status === "done" ? detail : undefined;
  });
  const answer = complete.steps.find((step) => step.nodeId === "team")?.output ?? "";
  assert.equal(answer.trim(), transfer.expected);
  assert.equal(complete.steps.find((step) => step.nodeId === "file")?.status, "done");
  const downstream = await readFile(join(exportDirectory, "handoff.txt"), "utf8");
  assert.equal(downstream, answer);
  await writeFile(join(out, "handoff.txt"), downstream);
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        localWorkerSha256: createHash("sha256")
          .update(
            await readFile(
              resolve(import.meta.dir, "../build/memdoor", process.platform === "win32" ? "memdoor.exe" : "memdoor"),
            ),
          )
          .digest("hex"),
        chat: { expected: chat.expected, messageId: final.id, answer: final.text },
        workflow: { id: workflow.summary.id, runId: complete.run.id, expected: transfer.expected, answer, downstream },
      },
      null,
      2,
    ),
  );
  process.stdout.write(`Workflow delivered ${transfer.expected} to the text file.\n`);
} finally {
  await browser.close();
}
