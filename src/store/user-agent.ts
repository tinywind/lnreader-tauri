import { create } from "zustand";
import { persist } from "zustand/middleware";

const LEGACY_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0";

function defaultWebviewUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

function normalizeUserAgent(userAgent: string): string {
  const trimmed = userAgent.trim();
  return trimmed === "" ? defaultWebviewUserAgent() : trimmed;
}

function isLegacyDefaultUserAgent(userAgent: unknown): boolean {
  return (
    typeof userAgent !== "string" ||
    userAgent.trim() === "" ||
    userAgent === LEGACY_DEFAULT_USER_AGENT
  );
}

export const DEFAULT_USER_AGENT = defaultWebviewUserAgent();

interface UserAgentState {
  userAgent: string;
  setUserAgent: (userAgent: string) => void;
  resetUserAgent: () => string;
}

export const useUserAgentStore = create<UserAgentState>()(
  persist(
    (set) => ({
      userAgent: DEFAULT_USER_AGENT,
      setUserAgent: (userAgent) =>
        set({
          userAgent: normalizeUserAgent(userAgent),
        }),
      resetUserAgent: () => {
        const userAgent = defaultWebviewUserAgent();
        set({ userAgent });
        return userAgent;
      },
    }),
    {
      name: "http-user-agent",
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as Partial<UserAgentState> | undefined;
        const persistedUserAgent = state?.userAgent;
        return {
          ...state,
          userAgent: isLegacyDefaultUserAgent(persistedUserAgent)
            ? DEFAULT_USER_AGENT
            : normalizeUserAgent(persistedUserAgent ?? DEFAULT_USER_AGENT),
        };
      },
    },
  ),
);

export function getScraperUserAgent(): string | null {
  return useUserAgentStore.getState().userAgent.trim() || null;
}
