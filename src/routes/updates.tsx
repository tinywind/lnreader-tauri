import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Badge,
  Container,
  Group,
  Image,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  listLibraryUpdates,
  type LibraryUpdateEntry,
} from "../db/queries/chapter";

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
            #{entry.position} — {entry.chapterName}
          </Text>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              Updated {formatDateTime(entry.updatedAt)}
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

  const query = useQuery({
    queryKey: ["chapter", "updates", UPDATES_LIMIT] as const,
    queryFn: () => listLibraryUpdates(UPDATES_LIMIT),
  });

  const openChapter = (chapterId: number) => {
    void navigate({ to: "/reader", search: { chapterId } });
  };
  const openNovel = (novelId: number) => {
    void navigate({ to: "/novel", search: { id: novelId } });
  };

  return (
    <Container py="lg" size="md">
      <Stack gap="md">
        <Title order={2}>Updates</Title>

        {query.isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Loading updates…</Text>
          </Group>
        ) : query.error ? (
          <Alert color="red" title="Failed to load updates">
            {query.error instanceof Error
              ? query.error.message
              : String(query.error)}
          </Alert>
        ) : query.data && query.data.length > 0 ? (
          <Stack gap="xs">
            {query.data.map((entry) => (
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
            No unread chapters in your library right now.
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
