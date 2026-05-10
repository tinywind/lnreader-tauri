import { useSiteBrowserStore } from "../../store/site-browser";
import type { Plugin } from "../plugins/types";
import {
  taskScheduler,
  type SourceTaskKind,
  type TaskHandle,
  type TaskPriority,
  type TaskRunContext,
  type TaskSubject,
} from "./scheduler";

interface SourceTaskOptions<T> {
  plugin: Pick<Plugin, "id" | "name">;
  kind: SourceTaskKind;
  title: string;
  priority?: Exclude<TaskPriority, "background">;
  subject?: TaskSubject;
  dedupeKey?: string;
  exclusive?: boolean;
  run: (context: TaskRunContext) => Promise<T>;
}

function debugOpenSiteTask(message: string, data?: unknown): void {
  console.debug(`[site-browser:task] ${message}`, data);
}

export function enqueueSourceTask<T>({
  dedupeKey,
  exclusive,
  kind,
  plugin,
  priority = "normal",
  run,
  subject,
  title,
}: SourceTaskOptions<T>): TaskHandle<T> {
  return taskScheduler.enqueueSource<T>({
    kind,
    priority,
    title,
    source: { id: plugin.id, name: plugin.name },
    subject: { ...subject, pluginId: plugin.id },
    dedupeKey,
    exclusive,
    run,
  });
}

export function enqueueOpenSiteTask(
  plugin: Pick<Plugin, "id" | "name">,
  url: string,
  title: string,
): TaskHandle<void> {
  return enqueueSourceTask<void>({
    plugin,
    kind: "source.openSite",
    priority: "interactive",
    exclusive: true,
    title,
    subject: { url },
    dedupeKey: `source.openSite:${plugin.id}:${url}`,
    run: async ({ signal, taskId }) =>
      new Promise<void>((resolve, reject) => {
        debugOpenSiteTask("started", {
          sourceId: plugin.id,
          sourceName: plugin.name,
          taskId,
          url,
        });
        const handleAbort = () => {
          const siteBrowser = useSiteBrowserStore.getState();
          if (siteBrowser.visible && siteBrowser.currentUrl === url) {
            siteBrowser.hide();
          }
          debugOpenSiteTask("cancelled", {
            sourceId: plugin.id,
            taskId,
            url,
          });
          cleanup();
          reject(new DOMException("Task was cancelled.", "AbortError"));
        };
        const cleanup = () => {
          signal.removeEventListener("abort", handleAbort);
          unsubscribe();
        };
        const unsubscribe = useSiteBrowserStore.subscribe((state) => {
          if (!state.visible || state.currentUrl !== url) {
            debugOpenSiteTask("closed", {
              sourceId: plugin.id,
              taskId,
              url,
              visible: state.visible,
              currentUrl: state.currentUrl,
            });
            cleanup();
            resolve();
          }
        });

        signal.addEventListener("abort", handleAbort, { once: true });
        debugOpenSiteTask("openAt", {
          sourceId: plugin.id,
          taskId,
          url,
        });
        useSiteBrowserStore.getState().openAt(url);
        if (signal.aborted) handleAbort();
      }),
  });
}
