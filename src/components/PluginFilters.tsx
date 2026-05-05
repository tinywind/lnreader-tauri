import {
  Checkbox,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useTranslation } from "../i18n";
import { FilterTypes, type Filters } from "../lib/plugins/filterTypes";

/**
 * Resolved filter values keyed by filter id. Shape matches
 * `FilterToValues<Filters>` — each entry carries `{ type, value }`.
 * Plain object so React state can do shallow-equal comparisons.
 */
export type ResolvedFilterValues = Record<
  string,
  { type: FilterTypes; value: unknown }
>;

interface PluginFiltersProps {
  schema: Filters;
  values: ResolvedFilterValues;
  onChange: (next: ResolvedFilterValues) => void;
}

/** Build the initial values map directly from a filter schema. */
export function defaultFilterValues(schema: Filters): ResolvedFilterValues {
  const out: ResolvedFilterValues = {};
  for (const [key, def] of Object.entries(schema)) {
    out[key] = { type: def.type, value: def.value };
  }
  return out;
}

function setEntry(
  values: ResolvedFilterValues,
  key: string,
  type: FilterTypes,
  value: unknown,
): ResolvedFilterValues {
  return { ...values, [key]: { type, value } };
}

export function PluginFilters({
  schema,
  values,
  onChange,
}: PluginFiltersProps) {
  const { t } = useTranslation();
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return <Text c="dimmed">{t("pluginFilters.empty")}</Text>;
  }

  return (
    <Stack gap="md">
      {entries.map(([key, def]) => {
        const current = values[key];
        switch (def.type) {
          case FilterTypes.TextInput: {
            const v = (current?.value ?? def.value) as string;
            return (
              <TextInput
                key={key}
                label={def.label}
                value={v}
                onChange={(event) =>
                  onChange(
                    setEntry(values, key, def.type, event.currentTarget.value),
                  )
                }
              />
            );
          }
          case FilterTypes.Switch: {
            const v = (current?.value ?? def.value) as boolean;
            return (
              <Switch
                key={key}
                label={def.label}
                checked={v}
                onChange={(event) =>
                  onChange(
                    setEntry(
                      values,
                      key,
                      def.type,
                      event.currentTarget.checked,
                    ),
                  )
                }
              />
            );
          }
          case FilterTypes.Picker: {
            const v = (current?.value ?? def.value) as string;
            return (
              <Select
                key={key}
                label={def.label}
                value={v}
                data={def.options.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                onChange={(next) =>
                  onChange(setEntry(values, key, def.type, next ?? ""))
                }
                allowDeselect={false}
              />
            );
          }
          case FilterTypes.CheckboxGroup: {
            const v = (current?.value ?? def.value) as string[];
            return (
              <Stack gap={4} key={key}>
                <Text size="sm" fw={500}>
                  {def.label}
                </Text>
                <Checkbox.Group
                  value={v}
                  onChange={(next) =>
                    onChange(setEntry(values, key, def.type, next))
                  }
                >
                  <Stack gap={4}>
                    {def.options.map((o) => (
                      <Checkbox
                        key={o.value}
                        value={o.value}
                        label={o.label}
                      />
                    ))}
                  </Stack>
                </Checkbox.Group>
              </Stack>
            );
          }
          case FilterTypes.ExcludableCheckboxGroup: {
            const v =
              (current?.value as
                | { include?: string[]; exclude?: string[] }
                | undefined) ??
              (def.value as { include?: string[]; exclude?: string[] });
            const include = v.include ?? [];
            const exclude = v.exclude ?? [];

            const setOption = (option: string, state: "" | "+" | "-") => {
              const nextInclude = include.filter((x) => x !== option);
              const nextExclude = exclude.filter((x) => x !== option);
              if (state === "+") nextInclude.push(option);
              else if (state === "-") nextExclude.push(option);
              onChange(
                setEntry(values, key, def.type, {
                  include: nextInclude,
                  exclude: nextExclude,
                }),
              );
            };

            return (
              <Stack gap={4} key={key}>
                <Text size="sm" fw={500}>
                  {def.label}
                </Text>
                <Stack gap={4}>
                  {def.options.map((o) => {
                    const state = include.includes(o.value)
                      ? "+"
                      : exclude.includes(o.value)
                        ? "-"
                        : "";
                    return (
                      <SegmentedControl
                        key={o.value}
                        size="xs"
                        value={state}
                        data={[
                          {
                            label: `${o.label} (${t("pluginFilters.off")})`,
                            value: "",
                          },
                          { label: t("pluginFilters.include"), value: "+" },
                          { label: t("pluginFilters.exclude"), value: "-" },
                        ]}
                        onChange={(next) =>
                          setOption(o.value, next as "" | "+" | "-")
                        }
                      />
                    );
                  })}
                </Stack>
              </Stack>
            );
          }
          default:
            return null;
        }
      })}
    </Stack>
  );
}
