import { useSyncExternalStore } from "react";
import { taskScheduler, type TaskSnapshot } from "./scheduler";

export function useTaskSnapshot(): TaskSnapshot {
  return useSyncExternalStore(
    taskScheduler.subscribe,
    taskScheduler.getSnapshot,
    taskScheduler.getSnapshot,
  );
}
