import { isAndroidRuntime } from "../tauri-runtime";
import type { TaskNotificationMode } from "../../store/notifications";
import {
  buildActiveTaskNotificationPayload,
  type TaskNotificationTranslate,
} from "./task-notification-model";
import { taskScheduler } from "./scheduler";

interface AndroidTaskNotificationBridge {
  stop: () => void;
  update: (payload: string) => void;
}

declare global {
  interface Window {
    __NoreaAndroidTasks?: AndroidTaskNotificationBridge;
  }
}

export function startAndroidTaskNotifications(
  t: TaskNotificationTranslate,
  mode: TaskNotificationMode,
): () => void {
  if (!isAndroidRuntime() || mode !== "progress") {
    window.__NoreaAndroidTasks?.stop();
    return () => undefined;
  }

  let lastPayload = "";

  const publish = () => {
    const bridge = window.__NoreaAndroidTasks;
    if (!bridge) return;

    const payload = buildActiveTaskNotificationPayload(
      taskScheduler.getSnapshot(),
      t,
    );
    if (!payload) {
      if (lastPayload !== "") {
        bridge.stop();
        lastPayload = "";
      }
      return;
    }

    const serialized = JSON.stringify(payload);
    if (serialized === lastPayload) return;
    bridge.update(serialized);
    lastPayload = serialized;
  };

  const unsubscribe = taskScheduler.subscribe(publish);
  publish();

  return () => {
    unsubscribe();
    if (lastPayload !== "") {
      window.__NoreaAndroidTasks?.stop();
    }
  };
}
