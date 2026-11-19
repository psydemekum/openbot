// Build the worker deployed by the fork from a fixed upstream commit and the reviewed patch.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const upstream = "https://github.com/guregodevo/memdoor.git";
const commit = "67e32e0cbf5bb0d055f155f526d16ee7863f179b";
const root = resolve(import.meta.dir, "..");
const patch = join(root, "vendor", "memdoor", "openbot.patch");
const target = join(root, "build", "memdoor");
const binary = process.platform === "win32" ? "memdoor.exe" : "memdoor";
const sourceArg = process.argv[2];
if (sourceArg && !isAbsolute(sourceArg)) throw new Error("The Memdoor source path must be absolute.");
const scratchRoot = realpathSync(tmpdir());
const scratch = mkdtempSync(join(scratchRoot, "openbot-memdoor-source-"));
const source = join(scratch, "memdoor");

function git(args: string[], directory = source): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

try {
  // Memdoor embeds these files as-is. Git Bash needs LF in the workflow scripts.
  git(
    ["clone", "--config", "core.autocrlf=false", "--filter=blob:none", "--no-checkout", sourceArg ?? upstream, source],
    scratch,
  );
  git(["checkout", "--detach", commit]);
  if (git(["rev-parse", "HEAD"]) !== commit) throw new Error("Unexpected Memdoor revision.");
  git(["apply", "--check", patch]);
  git(["apply", patch]);
  mkdirSync(target, { recursive: true });
  execFileSync("go", ["build", "-trimpath", "-o", join(target, binary), "./cmd/cli"], {
    cwd: source,
    env: { ...process.env, CGO_ENABLED: "0" },
    stdio: "inherit",
  });
  for (const name of ["LICENSE", "NOTICE"]) copyFileSync(join(source, name), join(target, name));
} finally {
  // mkdtemp created this exact, private child of the resolved temporary directory.
  rmSync(scratch, { recursive: true, maxRetries: 5, retryDelay: 200 });
}
