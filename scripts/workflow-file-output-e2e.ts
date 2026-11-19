// Runs file outputs on the real workflow service, SQLite and attachment store in a temporary profile.
// Run: bun scripts/workflow-file-output-e2e.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type WorkflowFields, type WorkflowStep, workflowFileResult } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { grantWorkflowExportFolder, storeWorkflowFile } from "../src/backend/workflows/file-storage";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-files-"));
const database = new OpenBotDatabase(directory);
const mailbox = new MailboxStore(directory, join(directory, "shared"), database);
const checks: string[] = [];
let service: WorkflowsHandle | undefined;
let notices = 0;
let writes = 0;
let failWrite = false;
let handoff: { agentId: string; text: string } | undefined;
let agentAnswer = "";
let request = 0;
const report = resolve(".openbot-build/workflow-file-output-e2e/report.json");

async function waitForStep(workflows: WorkflowsHandle, runId: string): Promise<WorkflowStep> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const detail = await runCauseEffect(workflows.run(runId));
    const step = detail.steps.find((candidate) => candidate.nodeId === "output");
    if (step && detail.run.status !== "running") return step;
    if (Date.now() > deadline) throw new Error("The file run did not finish.");
    await runCauseEffect(workflows.sweep());
    await new Promise<void>((done) => setImmediate(done));
  }
}

async function run(text: string | string[], fields: WorkflowFields, folderPath?: string) {
  assert.ok(service);
  const prompts = (typeof text === "string" ? [text] : text).map((value, index) => ({
    id: `prompt-${index}`,
    kind: "prompt" as const,
    at: { x: 0, y: index * 150 },
    fields: { text: value },
  }));
  const created = await runCauseEffect(service.create({ title: "File output check" }));
  if (folderPath) {
    const folder = await grantWorkflowExportFolder(
      directory,
      { workflowId: created.summary.id, nodeId: "output" },
      folderPath,
    );
    fields = { ...fields, folderGrantId: folder.id, folderName: folder.name };
  }
  const saved = await runCauseEffect(
    service.saveGraph({
      workflowId: created.summary.id,
      baseRevision: created.revision,
      graph: {
        nodes: [
          ...prompts,
          { id: "output", kind: "output", at: { x: 300, y: 0 }, fields: { target: "file", ...fields } },
        ],
        edges: prompts.map(({ id }) => ({ id: `edge-${id}`, from: id, to: "output", type: "text" })),
        strokes: [],
      },
    }),
  );
  assert.ok(saved.ok);
  const started = await runCauseEffect(
    service.startRun({ workflowId: created.summary.id, requestId: `file-${++request}` }),
  );
  return waitForStep(service, started.run.id);
}

async function contents(step: WorkflowStep) {
  assert.equal(step.status, "done", step.error ?? "The file output failed.");
  assert.ok(step.output);
  const result = workflowFileResult(step.output);
  assert.ok(result, "Clients must recognize the stored result.");
  const attachment = await runCauseEffect(mailbox.resolveAttachment(result.id));
  assert.ok(attachment, "The output must resolve to a stored attachment.");
  assert.equal(attachment.mimeType, result.mimeType);
  const text = await readFile(attachment.path, "utf8");
  assert.equal(Buffer.byteLength(text), result.size);
  return { result, text };
}

function openService() {
  return Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => ({ status: "completed", turnId: "file-turn", error: null }),
      turnAnswer: () => agentAnswer,
      sendHandoff: ({ agentId, text }) =>
        Effect.sync(() => {
          handoff = { agentId, text };
          return `file-delivery-${request}`;
        }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model is used." }),
      storeFile: (input) => {
        writes++;
        return failWrite
          ? Effect.fail({ cause: new Error("Disk full") })
          : storeWorkflowFile(directory, mailbox, input);
      },
      notify: () => {
        notices++;
      },
      connectionOn: () => false,
      post: () => Effect.succeed({ posted: true as const }),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
}

try {
  await runCauseEffect(mailbox.initialize());
  service = await openService();
  const plainStep = await run("Grüezi, Zürich!\nSecond line.", { format: "txt", filename: "bericht-{{date}}" });
  const plain = await contents(plainStep);
  assert.equal(plain.text, "Grüezi, Zürich!\nSecond line.");
  assert.match(plain.result.name, /^bericht-\d{4}-\d{2}-\d{2}\.txt$/);
  assert.equal(notices, 0);
  checks.push("TXT preserves UTF-8 and line breaks, expands the date and stays silent by default");
  const markdown = await contents(
    await run("# Report\n\n**Done**", { format: "md", filename: "report.md", notify: true }),
  );
  assert.equal(markdown.text, "# Report\n\n**Done**");
  assert.equal(markdown.result.name, "report.md");
  assert.equal(notices, 1);
  checks.push("Markdown is unchanged and notification is optional");
  const html = await contents(await run("Grüezi <script>alert(1)</script>", { format: "html" }));
  assert.match(html.text, /<!doctype html>/i);
  assert.match(html.text, /&lt;script&gt;/);
  const document = "<!doctype html><html><head><title>Report</title></head><body><h1>Grüezi</h1></body></html>";
  assert.equal((await contents(await run(document, { format: "html" }))).text, document);
  checks.push("HTML wraps plain text safely and preserves a supplied HTML document");
  const secret = await contents(await run("api_key=example_secret_value_123456789", { format: "txt" }));
  assert.ok(!secret.text.includes("example_secret_value_123456789"));
  checks.push("File exports redact secrets");
  const again = await contents(await run("New run", { format: "txt", filename: plain.result.name }));
  assert.notEqual(again.result.id, plain.result.id);
  assert.equal((await contents(await run("", { format: "txt" }))).text, "");
  checks.push("Runs keep separate files, including empty text");
  const verbatim = "    Grüezi\r\n\r\n";
  assert.equal((await contents(await run(verbatim, {}))).text, verbatim);
  assert.equal((await contents(await run(["first", "  second\n"], {}))).text, "first\n\n  second\n");
  const exact = "x".repeat(INPUT_LIMITS.workflowStepInput);
  const half = "x".repeat((exact.length - 2) / 2);
  assert.equal((await contents(await run([half, half], {}))).text, `${half}\n\n${half}`);
  const beforeOversize = writes;
  assert.equal((await run([half, `${half}x`], {})).status, "failed");
  assert.equal(writes, beforeOversize);
  checks.push("File input preserves whitespace and rejects oversized exports without writing a partial file");
  const agentFields = { agentId: "writer", prompt: "Fasse das Ergebnis zusammen.", format: "md" };
  agentAnswer = "    Ergebnis: Zürich\r\n\r\n";
  const authored = await contents(await run(verbatim, agentFields));
  assert.equal(authored.text, agentAnswer);
  assert.equal(handoff?.agentId, "writer");
  assert.ok(handoff?.text.includes(agentFields.prompt));
  assert.ok(handoff?.text.includes(`${verbatim}\n--- end input ---`));
  const beforeAgentFailure = writes;
  assert.equal((await run("Input", { ...agentFields, prompt: "" })).status, "failed");
  agentAnswer = "";
  assert.equal((await run("Input", agentFields)).status, "failed");
  agentAnswer = `${exact}x`;
  assert.equal((await run("Input", agentFields)).status, "failed");
  assert.equal(writes, beforeAgentFailure);
  checks.push("The selected agent gets the prompt and input; missing and oversized answers make no file");
  const destination = join(directory, "Grüezi");
  await mkdir(destination);
  const target = join(destination, "report.md");
  const fileFields = { filename: "report", format: "md" };
  const firstCopyStep = await run(verbatim, fileFields, destination);
  const firstCopy = await contents(firstCopyStep);
  assert.equal(await readFile(target, "utf8"), firstCopy.text);
  const reused = await grantWorkflowExportFolder(
    directory,
    { workflowId: "other-workflow", nodeId: "output" },
    destination,
  );
  assert.equal((await run("Forbidden", { ...fileFields, folderGrantId: reused.id })).status, "failed");
  agentAnswer = "  second copy\r\n";
  const copy = await contents(await run("Input", { ...fileFields, agentId: "writer", prompt: "Write." }, destination));
  assert.equal(await readFile(target, "utf8"), verbatim);
  const copyName = (await readdir(destination)).find((name) => name !== "report.md");
  assert.ok(copyName);
  assert.equal(await readFile(join(destination, copyName), "utf8"), copy.text);
  assert.equal(copy.text, agentAnswer);
  await rename(destination, join(directory, "Old folder"));
  await mkdir(destination);
  const moved = await runCauseEffect(
    service.startRun({ workflowId: firstCopyStep.workflowId, requestId: "replaced-folder" }),
  );
  assert.equal((await waitForStep(service, moved.run.id)).status, "failed");
  assert.deepEqual(await readdir(destination), []);
  checks.push(
    "Local copies match the attachment, never overwrite, and reject grants for another node or a replaced folder",
  );
  const invalid: WorkflowFields[] = [
    { filename: "../escape" },
    { filename: "C:\\escape" },
    { filename: "CON" },
    { filename: ".html" },
    { filename: "..CON.txt" },
    { format: "pdf" },
    { filename: "{{unknown}}" },
  ];
  for (const fields of invalid) {
    const before = writes;
    assert.equal((await run("Invalid", fields)).status, "failed");
    assert.equal(writes, before);
  }
  checks.push("Invalid names, paths, placeholders and formats fail before writing");
  failWrite = true;
  const beforeNotice = notices;
  assert.equal((await run("No disk", { notify: true })).status, "failed");
  assert.equal(notices, beforeNotice);
  checks.push("A storage failure fails the step and sends no success notification");
  await Effect.runPromise(service.close());
  database.connection
    .prepare("UPDATE workflow_steps SET status = 'running', ended_at = NULL, output = NULL WHERE step_id = ?")
    .run(plainStep.id);
  database.connection
    .prepare("UPDATE workflow_runs SET status = 'running', ended_at = NULL WHERE run_id = ?")
    .run(plainStep.runId);
  const beforeRestart = writes;
  service = await openService();
  await runCauseEffect(service.sweep());
  assert.ok(plainStep.runId);
  const recovered = await waitForStep(service, plainStep.runId);
  assert.equal(recovered.status, "failed");
  assert.equal(writes, beforeRestart);
  assert.equal((await contents(plainStep)).text, plain.text);
  checks.push("Restart keeps the existing file and fails an unfinished step without a duplicate write");
  await mkdir(resolve(".openbot-build/workflow-file-output-e2e"), { recursive: true });
  await writeFile(report, JSON.stringify({ passed: true, checks, directory }, null, 2));
} finally {
  if (service) await Effect.runPromise(service.close());
  database.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    (error: NodeJS.ErrnoException) => {
      if (process.platform !== "win32" || error.code !== "EBUSY") throw error;
      process.stderr.write(`Windows still holds the temporary profile: ${directory}\n`);
    },
  );
}
