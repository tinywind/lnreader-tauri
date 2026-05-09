import { Progress, Text } from "@mantine/core";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import {
  ArrowDownGlyph,
  ArrowUpGlyph,
  CloseGlyph,
  PauseGlyph,
  PlayGlyph,
  RetryGlyph,
  TrashGlyph,
} from "../components/ActionGlyphs";
import { ConsoleStatusDot } from "../components/ConsolePrimitives";
import { IconButton } from "../components/IconButton";
import { useTranslation, type TranslationKey } from "../i18n";
import { useTaskSnapshot } from "../lib/tasks/hooks";
import {
  taskScheduler,
  type TaskMoveTarget,
  type TaskPriority,
  type TaskRecord,
  type TaskSnapshot,
  type TaskStatus,
} from "../lib/tasks/scheduler";
import "../styles/tasks.css";

const ACTIVE_STATUSES = new Set<TaskStatus>(["queued", "running"]);

function isActiveTask(task: TaskRecord): boolean {
  return ACTIVE_STATUSES.has(task.status);
}

function taskQueueStatusRank(status: TaskStatus): number {
  switch (status) {
    case "running":
      return 0;
    case "queued":
      return 1;
    case "failed":
      return 2;
    case "cancelled":
      return 3;
    case "succeeded":
      return 4;
  }
}

function taskQueuePriorityRank(priority: TaskPriority): number {
  switch (priority) {
    case "interactive":
      return 0;
    case "user":
      return 1;
    case "normal":
      return 2;
    case "deferred":
      return 3;
    case "background":
      return 4;
  }
}

function taskQueueKey(task: TaskRecord): string {
  return task.lane === "main"
    ? "main"
    : `source:${task.source?.id ?? "unknown"}`;
}

function compareTaskQueueOrder(left: TaskRecord, right: TaskRecord): number {
  const status =
    taskQueueStatusRank(left.status) - taskQueueStatusRank(right.status);
  if (status !== 0) return status;

  if (
    left.status === "queued" &&
    right.status === "queued" &&
    taskQueueKey(left) === taskQueueKey(right) &&
    left.queueIndex !== undefined &&
    right.queueIndex !== undefined
  ) {
    return left.queueIndex - right.queueIndex;
  }

  if (isActiveTask(left) && isActiveTask(right)) {
    const priority =
      taskQueuePriorityRank(left.priority) -
      taskQueuePriorityRank(right.priority);
    if (priority !== 0) return priority;
    return left.createdAt - right.createdAt;
  }

  return right.createdAt - left.createdAt;
}

function taskStatusKey(status: TaskStatus): TranslationKey {
  switch (status) {
    case "queued":
      return "tasks.status.queued";
    case "running":
      return "tasks.status.running";
    case "succeeded":
      return "tasks.status.succeeded";
    case "failed":
      return "tasks.status.failed";
    case "cancelled":
      return "tasks.status.cancelled";
  }
}

function taskPriorityKey(priority: TaskPriority): TranslationKey {
  switch (priority) {
    case "interactive":
      return "tasks.priority.interactive";
    case "user":
      return "tasks.priority.user";
    case "normal":
      return "tasks.priority.normal";
    case "deferred":
      return "tasks.priority.deferred";
    case "background":
      return "tasks.priority.background";
  }
}

function statusTone(
  status: TaskStatus,
): "active" | "done" | "error" | "idle" | "warning" {
  switch (status) {
    case "queued":
      return "idle";
    case "running":
      return "active";
    case "succeeded":
      return "done";
    case "failed":
      return "error";
    case "cancelled":
      return "warning";
  }
}

function taskMeta(
  t: ReturnType<typeof useTranslation>["t"],
  task: TaskRecord,
): string {
  const lane =
    task.lane === "main" ? t("tasks.lane.main") : t("tasks.lane.source");
  return [task.source?.name, lane, t(taskPriorityKey(task.priority))]
    .filter(Boolean)
    .join(" / ");
}

function progressLabel(task: TaskRecord): string | null {
  const progress = task.progress;
  if (!progress?.total) return null;
  return `${progress.current}/${progress.total}`;
}

function hasBlockingSourceTask(
  task: TaskRecord,
  records: TaskRecord[],
): boolean {
  if (task.priority !== "background" || task.status !== "queued") {
    return false;
  }
  return records.some(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.lane === "source" &&
      candidate.source?.id === task.source?.id &&
      isActiveTask(candidate),
  );
}

function isSourceQueuePaused(task: TaskRecord, snapshot: TaskSnapshot): boolean {
  if (task.kind === "source.openSite") return false;
  return Boolean(
    task.source &&
      isActiveTask(task) &&
      (snapshot.sourceQueuesPaused ||
        snapshot.pausedSourceIds.includes(task.source.id)),
  );
}

function hasCancellableActiveTask(records: TaskRecord[]): boolean {
  return records.some((task) => task.canCancel && isActiveTask(task));
}

function TaskRow({
  blockingSourceTask,
  snapshot,
  task,
}: {
  blockingSourceTask: boolean;
  snapshot: TaskSnapshot;
  task: TaskRecord;
}) {
  const { t } = useTranslation();
  const sourcePaused = isSourceQueuePaused(task, snapshot);
  const label = progressLabel(task);
  const canMove =
    task.status === "queued" &&
    task.queueIndex !== undefined &&
    task.queueSize !== undefined &&
    task.queueSize > 1;
  const retry = () => {
    const handle = taskScheduler.retry(task.id);
    if (handle) void handle.promise.catch(() => undefined);
  };
  const move = (target: TaskMoveTarget) => {
    taskScheduler.moveQueuedTask(task.id, target);
  };

  return (
    <div className="lnr-task-row" data-status={task.status}>
      <ConsoleStatusDot
        status={statusTone(task.status)}
        label={t(taskStatusKey(task.status))}
      />
      <div className="lnr-task-row-main">
        <div className="lnr-task-row-heading">
          <Text className="lnr-task-row-title" lineClamp={1}>
            {task.title}
          </Text>
          {label ? <span className="lnr-task-progress-text">{label}</span> : null}
        </div>
        <Text className="lnr-task-row-meta" lineClamp={1}>
          {taskMeta(t, task)}
        </Text>
        {sourcePaused ? (
          <Text className="lnr-task-row-detail" lineClamp={1}>
            {snapshot.sourceQueuesPaused
              ? t("tasks.allSourcesPaused")
              : t("tasks.sourcePaused")}
          </Text>
        ) : blockingSourceTask ? (
          <Text className="lnr-task-row-detail" lineClamp={1}>
            {t("tasks.downloadWaiting")}
          </Text>
        ) : task.detail ? (
          <Text className="lnr-task-row-detail" lineClamp={1}>
            {task.detail}
          </Text>
        ) : null}
        {task.error ? (
          <Text className="lnr-task-row-error" lineClamp={1}>
            {task.error}
          </Text>
        ) : null}
        {task.progress ? (
          <Progress
            className="lnr-task-row-progress"
            size="xs"
            value={
              task.progress.total
                ? Math.min(
                    100,
                    (task.progress.current / task.progress.total) * 100,
                  )
                : 100
            }
            animated={!task.progress.total}
          />
        ) : null}
      </div>
      <div className="lnr-task-row-actions">
        <IconButton
          disabled={!canMove || task.queueIndex === 0}
          label={t("tasks.moveUp")}
          onClick={() => move("up")}
        >
          <ArrowUpGlyph />
        </IconButton>
        <IconButton
          disabled={
            !canMove ||
            task.queueIndex === undefined ||
            task.queueSize === undefined ||
            task.queueIndex >= task.queueSize - 1
          }
          label={t("tasks.moveDown")}
          onClick={() => move("down")}
        >
          <ArrowDownGlyph />
        </IconButton>
        {task.canCancel ? (
          <IconButton
            label={t("common.cancel")}
            onClick={() => taskScheduler.cancel(task.id)}
            tone="danger"
          >
            <CloseGlyph />
          </IconButton>
        ) : null}
        {task.canRetry ? (
          <IconButton label={t("common.retry")} onClick={retry}>
            <RetryGlyph />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function SummaryPill({
  children,
  tone,
}: {
  children: string;
  tone?: "error";
}) {
  return (
    <span className="lnr-task-summary-pill" data-tone={tone}>
      {children}
    </span>
  );
}

function TaskGroup({
  snapshot,
  sourceId,
  sourcePaused,
  tasks,
  title,
}: {
  snapshot: TaskSnapshot;
  sourceId?: string;
  sourcePaused?: boolean;
  tasks: TaskRecord[];
  title: string;
}) {
  const { t } = useTranslation();
  const hasCancellableTasks = hasCancellableActiveTask(tasks);

  return (
    <section className="lnr-task-group">
      <header className="lnr-task-group-header">
        <div className="lnr-task-group-copy">
          <Text className="lnr-task-group-title" lineClamp={1}>
            {title}
          </Text>
          <span className="lnr-task-group-count">
            {t("tasks.count", { count: tasks.length })}
          </span>
        </div>
        <div className="lnr-task-group-actions">
          {sourceId && !snapshot.sourceQueuesPaused ? (
            <IconButton
              active={sourcePaused}
              label={
                sourcePaused ? t("tasks.resumeSource") : t("tasks.pauseSource")
              }
              onClick={() => {
                if (sourcePaused) {
                  taskScheduler.resumeSourceQueue(sourceId);
                } else {
                  taskScheduler.pauseSourceQueue(sourceId);
                }
              }}
            >
              {sourcePaused ? <PlayGlyph /> : <PauseGlyph />}
            </IconButton>
          ) : null}
          {sourceId && hasCancellableTasks ? (
            <IconButton
              label={t("tasks.cancelSourceCurrent")}
              onClick={() =>
                taskScheduler.cancelActiveTasks({
                  sourceId,
                })
              }
              tone="danger"
            >
              <CloseGlyph />
            </IconButton>
          ) : null}
        </div>
      </header>
      <div className="lnr-task-rows">
        {tasks.map((task) => (
          <TaskRow
            blockingSourceTask={hasBlockingSourceTask(task, snapshot.records)}
            key={task.id}
            snapshot={snapshot}
            task={task}
          />
        ))}
      </div>
    </section>
  );
}

export function TasksPage() {
  const { t } = useTranslation();
  const snapshot = useTaskSnapshot();
  const tasks = [...snapshot.records].sort(compareTaskQueueOrder);
  const mainTasks = tasks.filter((task) => task.lane === "main");
  const sourceTasks = tasks.filter((task) => task.lane === "source");
  const taskStats = {
    running: tasks.filter((task) => task.status === "running").length,
    queued: tasks.filter((task) => task.status === "queued").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    succeeded: tasks.filter((task) => task.status === "succeeded").length,
  };
  const hasCancellableTasks = hasCancellableActiveTask(tasks);
  const sourceGroups = [
    ...new Set(sourceTasks.map((task) => task.source?.id)),
  ]
    .filter((sourceId): sourceId is string => typeof sourceId === "string")
    .map((sourceId) => {
      const groupTasks = sourceTasks.filter(
        (task) => task.source?.id === sourceId,
      );
      return {
        sourceId,
        sourceName: groupTasks[0]?.source?.name ?? sourceId,
        tasks: groupTasks,
      };
    })
    .sort((left, right) => {
      const sourceName = left.sourceName.localeCompare(
        right.sourceName,
        undefined,
        { sensitivity: "base" },
      );
      if (sourceName !== 0) return sourceName;
      return left.sourceId.localeCompare(right.sourceId);
    });

  return (
    <PageFrame className="lnr-tasks-page" size="wide">
      <PageHeader
        title={
          <span className="lnr-task-page-title">
            {t("tasks.title")}
            <span className="lnr-task-title-count">{tasks.length}</span>
          </span>
        }
        actions={
          <div className="lnr-task-header-actions">
            <IconButton
              active={snapshot.sourceQueuesPaused}
              disabled={sourceTasks.length === 0}
              label={
                snapshot.sourceQueuesPaused
                  ? t("tasks.resumeAll")
                  : t("tasks.pauseAll")
              }
              onClick={() => {
                if (snapshot.sourceQueuesPaused) {
                  taskScheduler.resumeSourceQueue();
                } else {
                  taskScheduler.pauseSourceQueue();
                }
              }}
            >
              {snapshot.sourceQueuesPaused ? <PlayGlyph /> : <PauseGlyph />}
            </IconButton>
            <IconButton
              disabled={!hasCancellableTasks}
              label={t("tasks.cancelAllCurrent")}
              onClick={() => taskScheduler.cancelActiveTasks()}
              tone="danger"
            >
              <CloseGlyph />
            </IconButton>
            <IconButton
              disabled={taskStats.failed === 0}
              label={t("tasks.clearErrors")}
              onClick={() => taskScheduler.clearFailedTasks()}
              tone="danger"
            >
              <TrashGlyph />
            </IconButton>
          </div>
        }
        meta={
          <div className="lnr-task-summary-strip">
            <SummaryPill>
              {t("tasks.summary.running", { count: taskStats.running })}
            </SummaryPill>
            <SummaryPill>
              {t("tasks.summary.queued", { count: taskStats.queued })}
            </SummaryPill>
            <SummaryPill tone={taskStats.failed > 0 ? "error" : undefined}>
              {t("tasks.summary.failed", { count: taskStats.failed })}
            </SummaryPill>
            <SummaryPill>
              {t("tasks.summary.done", { count: taskStats.succeeded })}
            </SummaryPill>
          </div>
        }
      />

      {tasks.length === 0 ? (
        <StateView
          color="blue"
          title={t("tasks.empty.title")}
          message={t("tasks.empty.message")}
        />
      ) : (
        <div className="lnr-task-shell">
          {mainTasks.length > 0 ? (
            <TaskGroup
              snapshot={snapshot}
              tasks={mainTasks}
              title={t("tasks.mainQueue")}
            />
          ) : null}
          {sourceGroups.map((group) => (
            <TaskGroup
              key={group.sourceId}
              snapshot={snapshot}
              sourceId={group.sourceId}
              sourcePaused={snapshot.pausedSourceIds.includes(group.sourceId)}
              tasks={group.tasks}
              title={group.sourceName}
            />
          ))}
        </div>
      )}
    </PageFrame>
  );
}
