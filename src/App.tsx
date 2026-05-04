import { Button, Code, Container, List, Stack, Text, Title } from "@mantine/core";

export function App() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Title order={1}>LNReaderTauri</Title>
        <Text c="dimmed">Sprint 0 scaffold — frontend up.</Text>
        <Text>
          A Tauri 2 light-novel reader for Windows, Linux, and Android. See
          {" "}
          <Code>prd.md</Code> for the plan.
        </Text>
        <List size="sm">
          <List.Item>React 19 + TypeScript + Vite</List.Item>
          <List.Item>Mantine 7 (UI)</List.Item>
          <List.Item>Tauri 2 (native shell — Rust backend pending toolchain install)</List.Item>
        </List>
        <Button>Smoke button</Button>
      </Stack>
    </Container>
  );
}
