import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0";

interface UserAgentState {
  userAgent: string;
  setUserAgent: (userAgent: string) => void;
  resetUserAgent: () => void;
}

export const useUserAgentStore = create<UserAgentState>()(
  persist(
    (set) => ({
      userAgent: DEFAULT_USER_AGENT,
      setUserAgent: (userAgent) =>
        set({
          userAgent:
            userAgent.trim() === "" ? DEFAULT_USER_AGENT : userAgent.trim(),
        }),
      resetUserAgent: () => set({ userAgent: DEFAULT_USER_AGENT }),
    }),
    { name: "http-user-agent" },
  ),
);
