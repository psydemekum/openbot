// Frozen optional workflows-files-v1 contract. Keep IPC types and limits out of this file.
// An output with target "file" stores UTF-8 text as a managed host attachment. Fields:
// format: "txt" (default), "md", or "html"; filename: a basename with optional {{date}},
// {{datum}} (UTC YYYY-MM-DD), and {{run}} (run id, or solo step id); notify: boolean.
// Each execution stores a separate attachment, even when names match. Empty input is valid.
// HTML documents are preserved; other text is escaped inside a complete HTML document.
// Secrets are redacted before storage. Invalid names and formats fail without writing.
// A successful step's output is JSON: {type:"workflow-file",id,name,mimeType,size}.
// id names the existing authenticated attachment route. No host path is returned.
// A process restart fails an unfinished file step; it never silently repeats a write.
// Clients offer this output only when the host advertises this capability.
export const WORKFLOWS_FILES_CAPABILITY = "workflows-files-v1";
