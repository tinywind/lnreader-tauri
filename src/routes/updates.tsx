import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Image,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { LibraryUpdateEntry } from "../db/queries/chapter";
import { checkLibraryUpdates } from "../lib/updates/check-library-updates";

const UPDATES_LIMIT = 200;
const FALLBACK_COVER = "https://placehold.co/56x84?text=?";

function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

interface UpdateRowProps {
  entry: LibraryUpdateEntry;
  onOpen: () => void;
  onOpenNovel: () => void;
}

function UpdateRow({ entry, onOpen, onOpenNovel }: UpdateRowProps) {
  return (
    <Paper
      p="sm"
      radius="sm"
      withBorder
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <Group wrap="nowrap" align="flex-start" gap="md">
        <Image
          src={entry.novelCover ?? FALLBACK_COVER}
          fallbackSrc={FALLBACK_COVER}
          w={56}
          h={84}
          alt={entry.novelName}
          radius="xs"
        />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Anchor
            size="sm"
            fw={600}
            onClick={(event) => {
              event.stopPropagation();
              onOpenNovel();
            }}
            style={{ cursor: "pointer" }}
          >
            {entry.novelName}
          </Anchor>
          <Text size="sm" lineClamp={1} title={entry.chapterName}>
            #{entry.position} - {entry.chapterName}
          </Text>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              Found {formatDateTime(entry.foundAt)}
            </Text>
            {entry.isDownloaded && (
              <Badge size="xs" color="teal" variant="light">
                Downloaded
              </Badge>
            )}
          </Group>
        </Stack>
      </Group>
    </Paper>
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
    <Container py="lg" size="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={2}>Updates</Title>
          <Button
            size="sm"
            loading={check.isPending}
            onClick={() => check.mutate()}
          >
            Check for updates
          </Button>
        </Group>

        {check.isPending ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Checking library sources...</Text>
          </Group>
        ) : check.error ? (
          <Alert color="red" title="Failed to check updates">
            {check.error instanceof Error
              ? check.error.message
              : String(check.error)}
          </Alert>
        ) : result ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Checked {result.checkedNovels} novel
              {result.checkedNovels === 1 ? "" : "s"}
              {result.skippedNovels > 0
                ? `, skipped ${result.skippedNovels} local novel${
                    result.skippedNovels === 1 ? "" : "s"
                  }`
                : ""}
              {result.failures.length > 0
                ? `, ${result.failures.length} failed`
                : ""}
              .
            </Text>

            {result.failures.length > 0 ? (
              <Alert color="yellow" title="Some sources failed">
                {result.failures
                  .slice(0, 3)
                  .map(
                    (failure) =>
                      `${failure.novelName}: ${failure.reason}`,
                  )
                  .join("\n")}
              </Alert>
            ) : null}

            {result.updates.length > 0 ? (
              <Stack gap="xs">
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
              <Alert color="blue" variant="light" title="Caught up">
                No unread chapters discovered after library registration.
              </Alert>
            )}
          </Stack>
        ) : (
          <Alert color="blue" variant="light" title="Manual check">
            Use the check button to refresh installed source plugins.
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
