import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hooksPath = ".githooks";
const hooksDirectory = resolve(repoRoot, hooksPath);

function runGit(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

const gitDir = runGit(["rev-parse", "--git-dir"]);
if (gitDir.error) {
  console.warn("Git is not available; skipping Git hook installation.");
  process.exit(0);
}
if (gitDir.status !== 0) {
  process.exit(0);
}

if (!existsSync(hooksDirectory)) {
  console.error("Git hooks directory not found: .githooks");
  process.exit(1);
}

const install = runGit(["config", "--local", "core.hooksPath", hooksPath]);
if (install.error || install.status !== 0) {
  console.error("Failed to configure Git hooks path.");
  if (install.stderr) console.error(install.stderr.trim());
  process.exit(install.status ?? 1);
}

console.log("Configured Git hooks path: .githooks");
