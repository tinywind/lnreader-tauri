import { create } from "zustand";
import { persist } from "zustand/middleware";

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "off",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

interface LoggingState {
  logLevel: LogLevel;
  setLogLevel: (logLevel: unknown) => void;
}

export const DEFAULT_LOGGING_SETTINGS = {
  logLevel: "info" as LogLevel,
};

const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);

export function normalizeLogLevel(logLevel: unknown): LogLevel {
  return typeof logLevel === "string" && LOG_LEVEL_SET.has(logLevel as LogLevel)
    ? (logLevel as LogLevel)
    : DEFAULT_LOGGING_SETTINGS.logLevel;
}

export const useLoggingStore = create<LoggingState>()(
  persist(
    (set) => ({
      ...DEFAULT_LOGGING_SETTINGS,
      setLogLevel: (logLevel) =>
        set({ logLevel: normalizeLogLevel(logLevel) }),
    }),
    {
      name: "app-logging-settings",
      partialize: (state) => ({
        logLevel: state.logLevel,
      }),
      merge: (persistedState, currentState) => {
        if (persistedState === null || typeof persistedState !== "object") {
          return currentState;
        }
        const persisted = persistedState as Partial<LoggingState>;
        return {
          ...currentState,
          logLevel: normalizeLogLevel(persisted.logLevel),
        };
      },
    },
  ),
);
