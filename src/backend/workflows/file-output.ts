import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { WORKFLOW_FILE_MIME, type WorkflowFields } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactSecrets } from "@openbot/logging";

/** Keep one extra code unit to distinguish an oversized export from an exact fit when the step runs. */
export function workflowFileInput(parts: readonly string[]): string {
  const bound = INPUT_LIMITS.workflowStepInput + 1;
  let text = "";
  for (const [index, part] of parts.entries()) {
    if (index) text += "\n\n".slice(0, bound - text.length);
    text += part.slice(0, bound - text.length);
    if (text.length === bound) break;
  }
  return text;
}

/** Prepares text bytes for the managed attachment store; never accepts a filesystem path. */
export function workflowFileOutput(fields: WorkflowFields, input: string, date: string, run: string) {
  if (input.length > INPUT_LIMITS.workflowStepInput)
    return { error: sourceText("error.workflow.fileTooLarge", { limit: INPUT_LIMITS.workflowStepInput }) };
  const format = fields.format ?? "txt";
  if (format !== "txt" && format !== "md" && format !== "html")
    return { error: sourceText("error.workflow.fileFormat") };
  if (fields.filename !== undefined && typeof fields.filename !== "string")
    return { error: sourceText("error.workflow.fileName") };
  const template =
    typeof fields.filename === "string" && fields.filename.trim() ? fields.filename.trim() : "workflow-{{date}}";
  const expanded = redactSecrets(
    template.replace(/{{(date|datum|run)}}/g, (_, key: string) => (key === "run" ? run : date)),
  );
  if (
    expanded.length > 180 ||
    /[<>:"/\\|?*\p{Cc}{}]/u.test(expanded) ||
    expanded.startsWith(".") ||
    /[. ]$/.test(expanded) ||
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(expanded)
  )
    return { error: sourceText("error.workflow.fileName") };
  const name = `${expanded.replace(/\.(txt|md|html)$/i, "")}.${format}`;
  let text = redactSecrets(input);
  if (format === "html" && !/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(text)) {
    const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    text = `<!doctype html>\n<html><head><meta charset="utf-8"><title>Workflow</title></head><body><pre>${escaped}</pre></body></html>\n`;
  }
  return { name, mimeType: WORKFLOW_FILE_MIME[format], bytes: new TextEncoder().encode(text) };
}

/** Agent output settings travel with the step so retries and a restart use the same request. */
export function workflowFileAgentInput(fields: WorkflowFields, text: string): string {
  return JSON.stringify({ fields, text });
}

export function readWorkflowFileAgentInput(input: string): { fields: WorkflowFields; text: string } {
  return JSON.parse(input);
}

export interface WorkflowFileWrite {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
  folder?: { workflowId: string; nodeId: string; grantId: string };
}
