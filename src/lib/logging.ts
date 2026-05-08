import { invoke } from "@tauri-apps/api/core";
import { normalizeLogLevel, type LogLevel } from "../store/logging";
import { isTauriRuntime } from "./tauri-runtime";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "trace" | "warn";
type ActiveLogLevel = Exclude<LogLevel, "off">;

const CONSOLE_METHODS: ConsoleMethod[] = [
  "trace",
  "debug",
  "log",
  "info",
  "warn",
  "error",
];

const CONSOLE_METHOD_LEVEL: Record<ConsoleMethod, ActiveLogLevel> = {
  trace: "trace",
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  off: 5,
};

const originalConsole: Record<ConsoleMethod, (...data: unknown[]) => void> = {
  trace: console.trace.bind(console),
  debug: console.debug.bind(console),
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let currentLogLevel: LogLevel = "info";
let consoleFilterInstalled = false;

function shouldLog(level: ActiveLogLevel): boolean {
  return (
    currentLogLevel !== "off" &&
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel]
  );
}

function applyNativeLogLevel(logLevel: LogLevel): void {
  if (!isTauriRuntime()) return;
  void invoke("set_runtime_log_level", { level: logLevel }).catch((error) => {
    originalConsole.warn("[logging] failed to set native log level", error);
  });
}

export function setRuntimeLogLevel(logLevel: unknown): LogLevel {
  const normalizedLogLevel = normalizeLogLevel(logLevel);
  currentLogLevel = normalizedLogLevel;
  applyNativeLogLevel(normalizedLogLevel);
  return normalizedLogLevel;
}

export function installRuntimeLogLevelFilter(logLevel: unknown): void {
  if (consoleFilterInstalled) {
    setRuntimeLogLevel(logLevel);
    return;
  }

  consoleFilterInstalled = true;
  for (const method of CONSOLE_METHODS) {
    console[method] = (...data: unknown[]) => {
      if (shouldLog(CONSOLE_METHOD_LEVEL[method])) {
        originalConsole[method](...data);
      }
    };
  }
  setRuntimeLogLevel(logLevel);
}
