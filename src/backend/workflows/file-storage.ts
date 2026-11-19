import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, win32 } from "node:path";
import { Effect } from "effect";
import type { MailboxStore } from "../mailbox-store";
import type { WorkflowFileWrite } from "./file-output";

type NodeRef = { workflowId: string; nodeId: string };
type FolderRef = NonNullable<WorkflowFileWrite["folder"]>;

function grantDirectory(profile: string): string {
  return join(profile, "workflow-export-folders");
}

async function folderIdentity(path: string) {
  const directory = await realpath(path);
  const entry = await stat(directory, { bigint: true });
  if (!entry.isDirectory()) throw new Error("The selected workflow export folder is not a directory.");
  return { directory, identity: `${entry.dev}:${entry.ino}` };
}

/** Only the desktop folder dialog can create a grant. The graph holds its id and display name. */
export async function grantWorkflowExportFolder(profile: string, node: NodeRef, path: string) {
  const { directory, identity } = await folderIdentity(path);
  const id = randomUUID();
  const grants = grantDirectory(profile);
  await mkdir(grants, { recursive: true });
  await writeFile(join(grants, id), JSON.stringify({ ...node, directory, identity }), { flag: "wx" });
  return { id, name: basename(directory) || directory };
}

async function exportFolder(profile: string, folder: FolderRef): Promise<string> {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(folder.grantId))
    throw new Error("Invalid workflow export folder grant.");
  const grant = JSON.parse(await readFile(join(grantDirectory(profile), folder.grantId), "utf8"));
  if (grant.workflowId !== folder.workflowId || grant.nodeId !== folder.nodeId || typeof grant.directory !== "string")
    throw new Error("The workflow export folder belongs to another node.");
  const current = await folderIdentity(grant.directory);
  if (current.directory !== grant.directory || current.identity !== grant.identity)
    throw new Error("The workflow export folder has changed.");
  return current.directory;
}

async function copyToFolder(directory: string, source: string, name: string, id: string) {
  if (name !== basename(name) || name !== win32.basename(name) || name.includes(":"))
    throw new Error("Invalid workflow export name.");
  try {
    await copyFile(source, join(directory, name), constants.COPYFILE_EXCL);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const extension = extname(name);
    await copyFile(source, join(directory, `${basename(name, extension)}-${id}${extension}`), constants.COPYFILE_EXCL);
  }
}

/** Keep the attachment for run history and optionally copy those same bytes to the approved folder. */
export const storeWorkflowFile = Effect.fn("Workflows.storeFile")(function* (
  profile: string,
  mailbox: Pick<MailboxStore, "storeGeneratedAttachment" | "resolveAttachment" | "deleteStoredFile">,
  { folder, ...file }: WorkflowFileWrite,
) {
  if (!folder) return yield* mailbox.storeGeneratedAttachment(file);
  const directory = yield* Effect.tryPromise({
    try: () => exportFolder(profile, folder),
    catch: (cause) => ({ cause }),
  });
  const stored = yield* mailbox.storeGeneratedAttachment(file);
  const copied = yield* Effect.result(
    Effect.gen(function* () {
      const source = yield* mailbox.resolveAttachment(stored.id);
      return yield* Effect.tryPromise({
        try: async () => {
          if (!source || (await exportFolder(profile, folder)) !== directory)
            throw new Error("The workflow export file or folder is unavailable.");
          await copyToFolder(directory, source.path, file.name, stored.id);
        },
        catch: (cause) => ({ cause }),
      });
    }),
  );
  if (copied._tag === "Success") return stored;
  yield* mailbox.deleteStoredFile(stored.id);
  return yield* Effect.fail(copied.failure);
});
