export type UpdatesIndexChangeReason =
  | "library-membership"
  | "novel-sync"
  | "read-progress"
  | "updates-cleared";

export interface UpdatesIndexChangeEvent {
  reason: UpdatesIndexChangeReason;
  revision: number;
}

type UpdatesIndexChangeListener = (event: UpdatesIndexChangeEvent) => void;

let revision = 0;
const listeners = new Set<UpdatesIndexChangeListener>();

export function getUpdatesIndexRevision(): number {
  return revision;
}

export function markUpdatesIndexDirty(
  reason: UpdatesIndexChangeReason,
): UpdatesIndexChangeEvent {
  revision += 1;
  const event = { reason, revision };
  for (const listener of listeners) listener(event);
  return event;
}

export function subscribeUpdatesIndexChanges(
  listener: UpdatesIndexChangeListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
