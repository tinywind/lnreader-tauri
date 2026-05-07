import {
  taskScheduler,
  type MainTaskKind,
  type TaskHandle,
  type TaskRunContext,
  type TaskSubject,
} from "./scheduler";

interface MainTaskOptions<T> {
  kind: MainTaskKind;
  title: string;
  subject?: TaskSubject;
  dedupeKey?: string;
  run: (context: TaskRunContext) => Promise<T>;
}

export function enqueueMainTask<T>({
  dedupeKey,
  kind,
  run,
  subject,
  title,
}: MainTaskOptions<T>): TaskHandle<T> {
  return taskScheduler.enqueueMain<T>({
    kind,
    priority: "normal",
    title,
    subject,
    dedupeKey,
    run,
  });
}
