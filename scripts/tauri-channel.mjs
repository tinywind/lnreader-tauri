import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = path.join(rootDir, "node_modules", "@tauri-apps", "cli", "tauri.js");

const args = process.argv.slice(2);

function hasConfigArg(values) {
  return values.some((value) => value === "--config" || value === "-c");
}

function withConfig(values, configPath) {
  if (hasConfigArg(values)) return values;
  const argsSeparator = values.indexOf("--");
  if (argsSeparator === -1) return [...values, "--config", configPath];
  return [
    ...values.slice(0, argsSeparator),
    "--config",
    configPath,
    ...values.slice(argsSeparator),
  ];
}

const localDebugConfig = "src-tauri/tauri.local-debug.conf.json";
const devBuildConfig = "src-tauri/tauri.dev.conf.json";
const command = args[0];
const androidCommand = args[0] === "android" ? args[1] : null;

let finalArgs = args;
if (command === "dev" || androidCommand === "dev") {
  finalArgs = withConfig(args, localDebugConfig);
} else if (command === "build" && process.env.NOREA_BUILD_CHANNEL === "dev") {
  finalArgs = withConfig(args, devBuildConfig);
}

const child = spawn(process.execPath, [tauriCli, ...finalArgs], {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
