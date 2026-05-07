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

function isChapterTask(task: TaskRecord): boolean {
  return task.kind.startsWith("chapter.");
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
  return Boolean(
    task.source &&
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

function TaskList({
  emptyMessage,
  records,
  title,
}: {
  emptyMessage: string;
  records: TaskRecord[];
  title: string;
}) {
  const snapshot = useTaskSnapshot();

  return (
    <ConsolePanel className="lnr-task-list" title={title}>
      {records.length === 0 ? (
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
      )}
    </ConsolePanel>
  );
}

export function TasksPage() {
  const { t } = useTranslation();
  const snapshot = useTaskSnapshot();
  const activeMainTasks = snapshot.records.filter(
    (task) => task.lane === "main" && isActiveTask(task),
  );
  const activeSourceTasks = snapshot.records.filter(
    (task) =>
      task.lane === "source" && !isChapterTask(task) && isActiveTask(task),
  );
  const backgroundTasks = snapshot.records.filter(
    (task) => isChapterTask(task) && isActiveTask(task),
  );
  const historyTasks = snapshot.records.filter((task) => !isActiveTask(task));
  const sourceGroups = [
    ...new Set(activeSourceTasks.map((task) => task.source?.id)),
  ]
    .filter((sourceId): sourceId is string => typeof sourceId === "string")
    .map((sourceId) => ({
      sourceId,
      sourceName:
        activeSourceTasks.find((task) => task.source?.id === sourceId)?.source
          ?.name ?? sourceId,
      tasks: activeSourceTasks.filter((task) => task.source?.id === sourceId),
    }));

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
        <TaskList
          title={t("tasks.mainQueue")}
          emptyMessage={t("tasks.empty.main")}
          records={activeMainTasks}
        />

        <ConsolePanel className="lnr-task-list" title={t("tasks.sourceQueues")}>
          {sourceGroups.length === 0 ? (
            <Text className="lnr-task-empty">{t("tasks.empty.source")}</Text>
          ) : (
            <Stack gap="md">
              {sourceGroups.map((group) => (
                <section className="lnr-task-source-group" key={group.sourceId}>
                  <ConsoleSectionHeader
                    eyebrow={t("common.source")}
                    title={group.sourceName}
                    count={t("tasks.count", { count: group.tasks.length })}
                  />
                  <Stack gap="xs">
                    {group.tasks.map((task) => (
                      <TaskRow
                        blockingSourceTask={hasBlockingSourceTask(
                          task,
                          snapshot.records,
                        )}
                        key={task.id}
                        snapshot={snapshot}
                        task={task}
                      />
                    ))}
                  </Stack>
                </section>
              ))}
            </Stack>
          )}
        </ConsolePanel>

        <TaskList
          title={t("tasks.backgroundDownloads")}
          emptyMessage={t("tasks.empty.downloads")}
          records={backgroundTasks}
        />

        <TaskList
          title={t("tasks.history")}
          emptyMessage={t("tasks.empty.history")}
          records={historyTasks.slice(0, 50)}
        />
      </div>
    </PageFrame>
  );
}
