import { useState } from "react";
import { Badge, Group, Progress, Stack, Text } from "@mantine/core";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import {
  ConsolePanel,
  ConsoleSectionHeader,
  ConsoleStatusDot,
} from "../components/ConsolePrimitives";
import { TextButton } from "../components/TextButton";
import { useTranslation, type TranslationKey } from "../i18n";
import { useTaskSnapshot } from "../lib/tasks/hooks";
import {
  taskScheduler,
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

function compareTaskQueueOrder(left: TaskRecord, right: TaskRecord): number {
  const status =
    taskQueueStatusRank(left.status) - taskQueueStatusRank(right.status);
  if (status !== 0) return status;

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
  return [task.source?.name, lane]
    .filter(Boolean)
    .join(" / ");
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
  const sourceExplicitlyPaused = task.source
    ? snapshot.pausedSourceIds.includes(task.source.id)
    : false;
  const retry = () => {
    const handle = taskScheduler.retry(task.id);
    if (handle) void handle.promise.catch(() => undefined);
  };

  return (
    <div className="lnr-task-row" data-status={task.status}>
      <div className="lnr-task-row-main">
        <Group gap="xs" wrap="wrap">
          <ConsoleStatusDot
            status={statusTone(task.status)}
            label={t(taskStatusKey(task.status))}
          />
          <Text className="lnr-task-row-title">{task.title}</Text>
        </Group>
        <Text className="lnr-task-row-meta">{taskMeta(t, task)}</Text>
        {sourcePaused ? (
          <Text className="lnr-task-row-detail">
            {snapshot.sourceQueuesPaused
              ? t("tasks.allSourcesPaused")
              : t("tasks.sourcePaused")}
          </Text>
        ) : blockingSourceTask ? (
          <Text className="lnr-task-row-detail">
            {t("tasks.downloadWaiting")}
          </Text>
        ) : task.detail ? (
          <Text className="lnr-task-row-detail">{task.detail}</Text>
        ) : null}
        {task.error ? (
          <Text className="lnr-task-row-error">{task.error}</Text>
        ) : null}
        {task.progress ? (
          <Progress
            mt="xs"
            size="sm"
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
      <Group className="lnr-task-row-actions" gap="xs" wrap="wrap">
        <Badge variant="light">{t(taskPriorityKey(task.priority))}</Badge>
        {sourcePaused ? <Badge variant="light">{t("tasks.paused")}</Badge> : null}
        {task.lane === "source" && task.source && !snapshot.sourceQueuesPaused ? (
          sourceExplicitlyPaused ? (
            <TextButton
              size="sm"
              variant="light"
              onClick={() => taskScheduler.resumeSourceQueue(task.source!.id)}
            >
              {t("tasks.resumeSource")}
            </TextButton>
          ) : (
            <TextButton
              size="sm"
              variant="default"
              onClick={() => taskScheduler.pauseSourceQueue(task.source!.id)}
            >
              {t("tasks.pauseSource")}
            </TextButton>
          )
        ) : null}
        {task.canCancel ? (
          <TextButton
            size="sm"
            variant="default"
            onClick={() => taskScheduler.cancel(task.id)}
          >
            {t("common.cancel")}
          </TextButton>
        ) : null}
        {task.canRetry ? (
          <TextButton size="sm" variant="light" onClick={retry}>
            {t("common.retry")}
          </TextButton>
        ) : null}
      </Group>
    </div>
  );
}

function CollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TextButton size="sm" variant="subtle" onClick={onToggle}>
      {collapsed ? t("tasks.expand") : t("tasks.collapse")}
    </TextButton>
  );
}

function TaskRows({
  emptyMessage,
  records,
  snapshot,
}: {
  emptyMessage: string;
  records: TaskRecord[];
  snapshot: TaskSnapshot;
}) {
  return records.length === 0 ? (
    <Text className="lnr-task-empty">{emptyMessage}</Text>
  ) : (
    <Stack className="lnr-task-rows" gap={0}>
      {records.map((task) => (
        <TaskRow
          blockingSourceTask={hasBlockingSourceTask(task, snapshot.records)}
          key={task.id}
          snapshot={snapshot}
          task={task}
        />
      ))}
    </Stack>
  );
}

export function TasksPage() {
  const { t } = useTranslation();
  const snapshot = useTaskSnapshot();
  const [taskGroupsCollapsed, setTaskGroupsCollapsed] = useState(false);
  const [collapsedSourceIds, setCollapsedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
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
    .map((sourceId) => ({
      sourceId,
      sourceName:
        sourceTasks.find((task) => task.source?.id === sourceId)?.source
          ?.name ?? sourceId,
      tasks: sourceTasks.filter((task) => task.source?.id === sourceId),
    }))
    .sort((left, right) => {
      const sourceName = left.sourceName.localeCompare(
        right.sourceName,
        undefined,
        { sensitivity: "base" },
      );
      if (sourceName !== 0) return sourceName;
      return left.sourceId.localeCompare(right.sourceId);
    });
  const toggleSourceGroup = (sourceId: string) => {
    setCollapsedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  return (
    <PageFrame className="lnr-tasks-page" size="wide">
      <PageHeader
        title={t("tasks.title")}
        description={t("tasks.description")}
      />

      {tasks.length === 0 ? (
        <StateView
          color="blue"
          title={t("tasks.empty.title")}
          message={t("tasks.empty.message")}
        />
      ) : null}

      {tasks.length > 0 ? (
        <div className="lnr-task-shell">
          <aside
            className="lnr-task-overview"
            aria-label={t("tasks.currentWork")}
          >
            <ConsolePanel className="lnr-task-overview-panel">
              <ConsoleSectionHeader
                title={t("tasks.currentWork")}
                count={t("tasks.count", { count: tasks.length })}
              />
              <div className="lnr-task-stat-grid">
                <Badge variant="light">
                  {t("tasks.summary.running", { count: taskStats.running })}
                </Badge>
                <Badge variant="light">
                  {t("tasks.summary.queued", { count: taskStats.queued })}
                </Badge>
                <Badge
                  variant="light"
                  color={taskStats.failed > 0 ? "red" : "gray"}
                >
                  {t("tasks.summary.failed", { count: taskStats.failed })}
                </Badge>
                <Badge variant="light">
                  {t("tasks.summary.done", { count: taskStats.succeeded })}
                </Badge>
              </div>
              <div className="lnr-task-overview-actions">
                <TextButton
                  className="lnr-task-overview-action"
                  disabled={sourceTasks.length === 0}
                  variant={snapshot.sourceQueuesPaused ? "light" : "default"}
                  onClick={() => {
                    if (snapshot.sourceQueuesPaused) {
                      taskScheduler.resumeSourceQueue();
                    } else {
                      taskScheduler.pauseSourceQueue();
                    }
                  }}
                >
                  {snapshot.sourceQueuesPaused
                    ? t("tasks.resumeAll")
                    : t("tasks.pauseAll")}
                </TextButton>
                <TextButton
                  className="lnr-task-overview-action"
                  disabled={!hasCancellableTasks}
                  tone="danger"
                  variant="default"
                  onClick={() => taskScheduler.cancelActiveTasks()}
                >
                  {t("tasks.cancelAllCurrent")}
                </TextButton>
                <TextButton
                  className="lnr-task-overview-action"
                  disabled={taskStats.failed === 0}
                  tone="danger"
                  variant="default"
                  onClick={() => taskScheduler.clearFailedTasks()}
                >
                  {t("tasks.clearErrors")}
                </TextButton>
              </div>
            </ConsolePanel>
          </aside>

          <ConsolePanel className="lnr-task-list">
            <ConsoleSectionHeader
              title={t("tasks.currentWork")}
              count={t("tasks.count", { count: tasks.length })}
              actions={
                <CollapseButton
                  collapsed={taskGroupsCollapsed}
                  onToggle={() => setTaskGroupsCollapsed((value) => !value)}
                />
              }
            />
            {taskGroupsCollapsed ? null : (
              <Stack gap="md">
                {mainTasks.length > 0 ? (
                  <section className="lnr-task-source-group">
                    <ConsoleSectionHeader
                      title={t("tasks.mainQueue")}
                      count={t("tasks.count", { count: mainTasks.length })}
                    />
                    <TaskRows
                      emptyMessage={t("tasks.empty.main")}
                      records={mainTasks}
                      snapshot={snapshot}
                    />
                  </section>
                ) : null}
                {sourceGroups.map((group) => {
                  const collapsed = collapsedSourceIds.has(group.sourceId);
                  const hasCancellableSourceTasks = hasCancellableActiveTask(
                    group.tasks,
                  );
                  return (
                    <section
                      className="lnr-task-source-group"
                      key={group.sourceId}
                    >
                      <ConsoleSectionHeader
                        eyebrow={t("common.source")}
                        title={group.sourceName}
                        count={t("tasks.count", { count: group.tasks.length })}
                        actions={
                          <>
                            {hasCancellableSourceTasks ? (
                              <TextButton
                                size="sm"
                                tone="danger"
                                variant="default"
                                onClick={() =>
                                  taskScheduler.cancelActiveTasks({
                                    sourceId: group.sourceId,
                                  })
                                }
                              >
                                {t("tasks.cancelSourceCurrent")}
                              </TextButton>
                            ) : null}
                            <CollapseButton
                              collapsed={collapsed}
                              onToggle={() => toggleSourceGroup(group.sourceId)}
                            />
                          </>
                        }
                      />
                      {collapsed ? null : (
                        <TaskRows
                          emptyMessage={t("tasks.empty.source")}
                          records={group.tasks}
                          snapshot={snapshot}
                        />
                      )}
                    </section>
                  );
                })}
              </Stack>
            )}
          </ConsolePanel>
        </div>
      ) : null}
    </PageFrame>
  );
}
