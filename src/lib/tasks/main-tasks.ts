import {
  taskScheduler,
  type MainLaneTaskKind,
  type TaskHandle,
  type TaskPriority,
  type TaskRunContext,
  type TaskSubject,
} from "./scheduler";

interface MainTaskOptions<T> {
  kind: MainLaneTaskKind;
  title: string;
  priority?: TaskPriority;
  subject?: TaskSubject;
  dedupeKey?: string;
  run: (context: TaskRunContext) => Promise<T>;
}

export function enqueueMainTask<T>({
  dedupeKey,
  kind,
  priority = "normal",
  run,
  subject,
  title,
}: MainTaskOptions<T>): TaskHandle<T> {
  return taskScheduler.enqueueMain<T>({
    kind,
    priority,
    title,
    subject,
    dedupeKey,
    run,
  });
}
