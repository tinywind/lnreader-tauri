import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TaskNotificationMode = "off" | "completion" | "progress";

interface NotificationState {
  taskProgressMode: TaskNotificationMode;
  setTaskProgressMode: (taskProgressMode: unknown) => void;
}

export const DEFAULT_NOTIFICATION_SETTINGS = {
  taskProgressMode: "progress" as TaskNotificationMode,
};

export function normalizeTaskNotificationMode(
  taskProgressMode: unknown,
): TaskNotificationMode {
  switch (taskProgressMode) {
    case "off":
    case "completion":
    case "progress":
      return taskProgressMode;
    default:
      return DEFAULT_NOTIFICATION_SETTINGS.taskProgressMode;
  }
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      setTaskProgressMode: (taskProgressMode) =>
        set({
          taskProgressMode: normalizeTaskNotificationMode(taskProgressMode),
        }),
    }),
    {
      name: "app-notification-settings",
      partialize: (state) => ({
        taskProgressMode: state.taskProgressMode,
      }),
      merge: (persistedState, currentState) => {
        if (persistedState === null || typeof persistedState !== "object") {
          return currentState;
        }
        const persisted = persistedState as Partial<NotificationState>;
        return {
          ...currentState,
          taskProgressMode: normalizeTaskNotificationMode(
            persisted.taskProgressMode,
          ),
        };
      },
    },
  ),
);
