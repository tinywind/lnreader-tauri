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
    case "normal":
      return 1;
    case "background":
      return 2;
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
    case "normal":
      return "tasks.priority.normal";
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
      candidate.priority !== "background" &&
      isActiveTask(candidate),
  );
}

function isSourceQueuePaused(task: TaskRecord, snapshot: TaskSnapshot): boolean {
  if (task.priority === "interactive") return false;
  return Boolean(
    task.source &&
      isActiveTask(task) &&
      (snapshot.sourceQueuesPaused ||
        snapshot.pausedSourceIds.includes(task.source.id)),
  );
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
    <Stack gap="xs">
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

function TaskQueuePanel({
  collapsed,
  emptyMessage,
  onToggle,
  records,
  title,
}: {
  collapsed: boolean;
  emptyMessage: string;
  onToggle: () => void;
  records: TaskRecord[];
  title: string;
}) {
  const { t } = useTranslation();
  const snapshot = useTaskSnapshot();

  return (
    <ConsolePanel className="lnr-task-list">
      <ConsoleSectionHeader
        title={title}
        count={t("tasks.count", { count: records.length })}
        actions={<CollapseButton collapsed={collapsed} onToggle={onToggle} />}
      />
      {collapsed ? null : (
        <TaskRows
          emptyMessage={emptyMessage}
          records={records}
          snapshot={snapshot}
        />
      )}
    </ConsolePanel>
  );
}

export function TasksPage() {
  const { t } = useTranslation();
  const snapshot = useTaskSnapshot();
  const [mainCollapsed, setMainCollapsed] = useState(false);
  const [sourceQueuesCollapsed, setSourceQueuesCollapsed] = useState(false);
  const [collapsedSourceIds, setCollapsedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const mainTasks = snapshot.records
    .filter((task) => task.lane === "main")
    .sort(compareTaskQueueOrder);
  const sourceTasks = snapshot.records
    .filter((task) => task.lane === "source")
    .sort(compareTaskQueueOrder);
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
        meta={
          <>
            <Badge variant="light">
              {t("tasks.summary.running", { count: snapshot.running })}
            </Badge>
            <Badge variant="light">
              {t("tasks.summary.queued", { count: snapshot.queued })}
            </Badge>
            <Badge variant="light" color={snapshot.failed > 0 ? "red" : "gray"}>
              {t("tasks.summary.failed", { count: snapshot.failed })}
            </Badge>
            <Badge variant="light">
              {t("tasks.summary.done", { count: snapshot.succeeded })}
            </Badge>
            <TextButton
              size="sm"
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
          </>
        }
      />

      {snapshot.records.length === 0 ? (
        <StateView
          color="blue"
          title={t("tasks.empty.title")}
          message={t("tasks.empty.message")}
        />
      ) : null}

      <div className="lnr-task-board">
        <TaskQueuePanel
          collapsed={mainCollapsed}
          title={t("tasks.mainQueue")}
          emptyMessage={t("tasks.empty.main")}
          records={mainTasks}
          onToggle={() => setMainCollapsed((collapsed) => !collapsed)}
        />

        <ConsolePanel className="lnr-task-list">
          <ConsoleSectionHeader
            title={t("tasks.sourceQueues")}
            count={t("tasks.count", { count: sourceTasks.length })}
            actions={
              <CollapseButton
                collapsed={sourceQueuesCollapsed}
                onToggle={() =>
                  setSourceQueuesCollapsed((collapsed) => !collapsed)
                }
              />
            }
          />
          {sourceQueuesCollapsed ? null : sourceGroups.length === 0 ? (
            <Text className="lnr-task-empty">{t("tasks.empty.source")}</Text>
          ) : (
            <Stack gap="md">
              {sourceGroups.map((group) => {
                const collapsed = collapsedSourceIds.has(group.sourceId);
                return (
                  <section className="lnr-task-source-group" key={group.sourceId}>
                    <ConsoleSectionHeader
                      eyebrow={t("common.source")}
                      title={group.sourceName}
                      count={t("tasks.count", { count: group.tasks.length })}
                      actions={
                        <CollapseButton
                          collapsed={collapsed}
                          onToggle={() => toggleSourceGroup(group.sourceId)}
                        />
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
    </PageFrame>
  );
}
