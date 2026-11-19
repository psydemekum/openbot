import { isDynamicRecord } from "./runtime-values";

export { WORKFLOWS_FILE_AGENT_CAPABILITY, WORKFLOWS_FILES_CAPABILITY } from "./team-protocol/workflows-files-v1";
export const WORKFLOW_FILE_FORMATS = ["txt", "md", "html"] as const;
export type WorkflowFileFormat = (typeof WORKFLOW_FILE_FORMATS)[number];
export const WORKFLOW_FILE_MIME = {
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
} as const;

/** A file output keeps this JSON in the existing step output field. No host path crosses the boundary. */
export interface WorkflowFileResult {
  type: "workflow-file";
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Returns only complete file results; ordinary text outputs are not files. */
export function workflowFileResult(output: string | null | undefined): WorkflowFileResult | undefined {
  if (!output?.startsWith("{")) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (
    !isDynamicRecord(value) ||
    value.type !== "workflow-file" ||
    typeof value.id !== "string" ||
    !/^[\w-]{1,128}$/.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name ||
    value.name.length > 200 ||
    /[\\/\p{Cc}]/u.test(value.name) ||
    typeof value.mimeType !== "string" ||
    !Object.values(WORKFLOW_FILE_MIME).some((mime) => mime === value.mimeType) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0
  )
    return undefined;
  return { type: "workflow-file", id: value.id, name: value.name, mimeType: value.mimeType, size: value.size };
}
