import { invoke } from "@tauri-apps/api/core";
import { isWindowsRuntime } from "../tauri-runtime";
import { taskScheduler } from "./scheduler";
import {
  buildTrayTaskProgressPayload,
  type TaskNotificationTranslate,
} from "./task-notification-model";

const TRAY_UPDATE_DELAY_MS = 250;

export function startTrayTaskProgress(
  t: TaskNotificationTranslate,
): () => void {
  if (!isWindowsRuntime()) return () => undefined;

  let disposed = false;
  let lastPayload = "";
  let publishTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => {
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      if (disposed) return;

      const payload = buildTrayTaskProgressPayload(
        taskScheduler.getSnapshot(),
        t,
      );
      const serialized = JSON.stringify(payload);
      if (serialized === lastPayload) return;
      lastPayload = serialized;

      void invoke("tray_set_task_progress", {
        items: payload.items,
        summary: payload.summary,
      }).catch((error) => {
        console.info("[tray-task-progress] update failed", error);
      });
    }, TRAY_UPDATE_DELAY_MS);
  };

  const unsubscribe = taskScheduler.subscribe(publish);
  publish();

  return () => {
    disposed = true;
    if (publishTimer) clearTimeout(publishTimer);
    unsubscribe();
    void invoke("tray_set_task_progress", {
      items: [],
      summary: t("tasks.tray.none"),
    }).catch(() => undefined);
  };
}
