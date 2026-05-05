import { Button, CloseButton, Group, TextInput } from "@mantine/core";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Optional explicit submit handler. When set, the search input
   * stops debouncing and instead a "Search" button (and the Enter
   * key) trigger this callback.
   */
  onSubmit?: () => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder,
}: SearchBarProps) {
  const input = (
    <TextInput
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={
        onSubmit
          ? (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }
          : undefined
      }
      placeholder={placeholder ?? "Search library..."}
      size="sm"
      style={{ flex: 1, maxWidth: 480 }}
      rightSection={
        value.length > 0 ? (
          <CloseButton
            size="sm"
            aria-label="Clear search"
            onClick={() => onChange("")}
          />
        ) : null
      }
    />
  );

  if (!onSubmit) return input;

  return (
    <Group gap="xs" wrap="nowrap" style={{ flex: 1, maxWidth: 600 }}>
      {input}
      <Button size="sm" onClick={onSubmit}>
        Search
      </Button>
    </Group>
  );
}
