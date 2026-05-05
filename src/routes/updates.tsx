import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import {
  ConsoleChip,
  ConsoleCover,
  ConsolePanel,
  ConsoleSectionHeader,
  ConsoleStatusDot,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import type { LibraryUpdateEntry } from "../db/queries/chapter";
import {
  checkLibraryUpdates,
  type UpdateCheckFailure,
  type UpdateCheckResult,
} from "../lib/updates/check-library-updates";
import "../styles/updates.css";

const UPDATES_LIMIT = 200;
const FALLBACK_COVER = "https://placehold.co/56x84?text=?";

function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

function plural(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

interface SourceUpdateState {
  failures: number;
  pluginId: string;
  updates: number;
}

function getSourceStates(result: UpdateCheckResult | undefined): SourceUpdateState[] {
  if (!result) return [];
  const sources = new Map<string, SourceUpdateState>();

  for (const entry of result.updates) {
    const current =
      sources.get(entry.pluginId) ??
      { failures: 0, pluginId: entry.pluginId, updates: 0 };
    current.updates += 1;
    sources.set(entry.pluginId, current);
  }

  for (const failure of result.failures) {
    const current =
      sources.get(failure.pluginId) ??
      { failures: 0, pluginId: failure.pluginId, updates: 0 };
    current.failures += 1;
    sources.set(failure.pluginId, current);
  }

  return [...sources.values()].sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId),
  );
}

interface UpdateSummaryProps {
  result: UpdateCheckResult | undefined;
  running: boolean;
}

function UpdateSummary({ result, running }: UpdateSummaryProps) {
  const updates = result?.updates.length ?? 0;
  const failures = result?.failures.length ?? 0;
  const checked = result?.checkedNovels ?? 0;
  const skipped = result?.skippedNovels ?? 0;

  return (
    <ConsolePanel className="lnr-updates-summary">
      <div className="lnr-updates-summary-grid">
        <div>
          <Text className="lnr-console-kicker">Queue state</Text>
          <Group gap="xs" mt={6} wrap="wrap">
            <ConsoleStatusDot
              status={running ? "active" : failures > 0 ? "warning" : "idle"}
              label={running ? "checking" : result ? "ready" : "idle"}
            />
            <ConsoleChip active={updates > 0} tone={updates > 0 ? "accent" : "default"}>
              {plural(updates, "update")}
            </ConsoleChip>
            <ConsoleChip tone={failures > 0 ? "warning" : "default"}>
              {plural(failures, "failure")}
            </ConsoleChip>
          </Group>
        </div>

        <div>
          <Text className="lnr-console-kicker">Source check</Text>
          <Text className="lnr-updates-summary-value" mt={4}>
            {plural(checked, "novel")}
          </Text>
          <Text className="lnr-updates-summary-copy">
            {skipped > 0
              ? `${plural(skipped, "local novel")} skipped`
              : "No local novels skipped"}
          </Text>
        </div>

        <div>
          <Text className="lnr-console-kicker">Limit</Text>
          <Text className="lnr-updates-summary-value" mt={4}>
            {UPDATES_LIMIT}
          </Text>
          <Text className="lnr-updates-summary-copy">
            unread chapters per run
          </Text>
        </div>
      </div>
    </ConsolePanel>
  );
}

function SourceStatePanel({
  result,
  running,
  onRetry,
}: {
  result: UpdateCheckResult | undefined;
  running: boolean;
  onRetry: () => void;
}) {
  const sources = getSourceStates(result);

  return (
    <ConsolePanel className="lnr-updates-source-state" title="Source state">
      {sources.length > 0 ? (
        <div className="lnr-updates-source-grid">
          {sources.map((source) => {
            const status =
              source.failures > 0
                ? "error"
                : source.updates > 0
                  ? "active"
                  : "done";
            return (
              <div className="lnr-updates-source-row" key={source.pluginId}>
                <ConsoleStatusDot status={status} label={source.pluginId} />
                <ConsoleChip tone={source.updates > 0 ? "accent" : "default"}>
                  {plural(source.updates, "update")}
                </ConsoleChip>
                <ConsoleChip tone={source.failures > 0 ? "error" : "default"}>
                  {plural(source.failures, "failure")}
                </ConsoleChip>
                {source.failures > 0 ? (
                  <Button size="compact-xs" variant="subtle" onClick={onRetry}>
                    Retry source
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="lnr-updates-source-empty">
          <ConsoleStatusDot
            status={running ? "active" : "idle"}
            label={running ? "checking sources" : "no source state yet"}
          />
        </div>
      )}
    </ConsolePanel>
  );
}

interface FailureRowProps {
  failure: UpdateCheckFailure;
  onOpenNovel: () => void;
}

function FailureRow({ failure, onOpenNovel }: FailureRowProps) {
  return (
    <div className="lnr-updates-failure-row">
      <div className="lnr-updates-failure-main">
        <Group gap="xs" wrap="nowrap">
          <ConsoleStatusDot status="error" label="failed" />
          <button
            className="lnr-updates-link"
            type="button"
            onClick={onOpenNovel}
          >
            {failure.novelName}
          </button>
        </Group>
        <Text className="lnr-updates-row-meta" title={failure.reason}>
          {failure.pluginId} / {failure.reason}
        </Text>
      </div>
      <Button size="xs" variant="light" color="gray" onClick={onOpenNovel}>
        Details
      </Button>
    </div>
  );
}

interface UpdateRowProps {
  entry: LibraryUpdateEntry;
  onOpen: () => void;
  onOpenNovel: () => void;
}

function UpdateRow({ entry, onOpen, onOpenNovel }: UpdateRowProps) {
  const status = entry.isDownloaded ? "done" : "active";

  return (
    <div
      className="lnr-updates-row"
      role="button"
      tabIndex={0}
      aria-label={`Open chapter ${entry.chapterName}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
    >
      <ConsoleCover
        alt={entry.novelName}
        fallbackSrc={FALLBACK_COVER}
        height={72}
        src={entry.novelCover}
        width={48}
      />

      <div className="lnr-updates-row-main">
        <Group gap="xs" wrap="nowrap">
          <ConsoleStatusDot
            status={status}
            label={entry.isDownloaded ? "downloaded" : "new"}
          />
          <button
            className="lnr-updates-link"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNovel();
            }}
          >
            {entry.novelName}
          </button>
        </Group>
        <Text className="lnr-updates-row-title" title={entry.chapterName}>
          #{entry.position} - {entry.chapterName}
        </Text>
        <Group gap="xs" mt={6} wrap="wrap">
          <ConsoleChip>{entry.pluginId}</ConsoleChip>
          <ConsoleChip>Novel #{entry.novelId}</ConsoleChip>
          <ConsoleChip tone={entry.isDownloaded ? "success" : "accent"}>
            {entry.isDownloaded ? "cached" : "unread"}
          </ConsoleChip>
          <Text className="lnr-updates-row-meta">
            Found {formatDateTime(entry.foundAt)}
          </Text>
        </Group>
      </div>

      <div className="lnr-updates-row-actions">
        <Button
          size="xs"
          variant="filled"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          Read
        </Button>
        <Button
          size="xs"
          variant="light"
          color="gray"
          onClick={(event) => {
            event.stopPropagation();
            onOpenNovel();
          }}
        >
          Details
        </Button>
      </div>
    </div>
  );
}

export function UpdatesPage() {
  const navigate = useNavigate();

  const check = useMutation({
    mutationFn: () => checkLibraryUpdates(UPDATES_LIMIT),
  });

  const openChapter = (chapterId: number) => {
    void navigate({ to: "/reader", search: { chapterId } });
  };
  const openNovel = (novelId: number) => {
    void navigate({ to: "/novel", search: { id: novelId } });
  };

  const result = check.data;

  return (
    <PageFrame className="lnr-updates-page" size="wide">
      <PageHeader
        eyebrow="/updates"
        title="Updates"
        description="Refresh installed sources and process newly indexed unread chapters."
        actions={
          <Button
            size="sm"
            loading={check.isPending}
            onClick={() => check.mutate()}
          >
            Check for updates
          </Button>
        }
      />

      <UpdateSummary result={result} running={check.isPending} />
      <SourceStatePanel
        result={result}
        running={check.isPending}
        onRetry={() => check.mutate()}
      />

      {check.isPending ? (
        <StateView
          title={
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed">Checking library sources...</Text>
            </Group>
          }
        />
      ) : check.error ? (
        <StateView
          action={{ label: "Retry", onClick: () => check.mutate() }}
          color="red"
          title="Failed to check updates"
          message={
            check.error instanceof Error
              ? check.error.message
              : String(check.error)
          }
        />
      ) : result ? (
        <Stack gap="md">
          {result.failures.length > 0 ? (
            <ConsolePanel
              className="lnr-updates-failures"
              title="Source failures"
            >
              <Stack gap={0}>
                {result.failures.map((failure) => (
                  <FailureRow
                    key={failure.novelId}
                    failure={failure}
                    onOpenNovel={() => openNovel(failure.novelId)}
                  />
                ))}
              </Stack>
              <div className="lnr-updates-failure-footer">
                <Text className="lnr-updates-row-meta">
                  Retry runs the full source check again. Failed novels remain
                  visible so the source issue is not hidden by successful rows.
                </Text>
                <Button size="xs" variant="light" onClick={() => check.mutate()}>
                  Retry failed check
                </Button>
              </div>
            </ConsolePanel>
          ) : null}

          <ConsolePanel className="lnr-updates-queue">
            <ConsoleSectionHeader
              eyebrow="Work queue"
              title="Unread chapter updates"
              count={plural(result.updates.length, "row")}
            />

            {result.updates.length > 0 ? (
              <Stack gap={0} mt="sm">
                {result.updates.map((entry) => (
                  <UpdateRow
                    key={entry.chapterId}
                    entry={entry}
                    onOpen={() => openChapter(entry.chapterId)}
                    onOpenNovel={() => openNovel(entry.novelId)}
                  />
                ))}
              </Stack>
            ) : (
              <StateView
                color="blue"
                title="Caught up"
                message="No unread chapters were discovered after library registration."
              />
            )}
          </ConsolePanel>
        </Stack>
      ) : (
        <StateView
          action={{ label: "Check now", onClick: () => check.mutate() }}
          color="blue"
          title="Manual check"
          message="Use the check button to refresh installed source plugins."
        />
      )}

      <ConsoleStatusStrip>
        <span>{result ? plural(result.checkedNovels, "checked novel") : "No check run yet"}</span>
        <span>{result ? plural(result.skippedNovels, "skipped local novel") : "Manual refresh"}</span>
        <span>{result ? plural(result.failures.length, "source failure") : `Limit ${UPDATES_LIMIT}`}</span>
      </ConsoleStatusStrip>
    </PageFrame>
  );
}
