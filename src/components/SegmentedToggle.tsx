import {
  SegmentedControl,
  type SegmentedControlProps,
} from "@mantine/core";

type SegmentedToggleClassNames = Partial<
  Record<"control" | "indicator" | "input" | "label" | "root", string>
>;

interface SegmentedToggleProps
  extends Omit<SegmentedControlProps, "classNames" | "size"> {
  classNames?: SegmentedToggleClassNames;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function SegmentedToggle({
  className,
  classNames,
  ...props
}: SegmentedToggleProps) {
  return (
    <SegmentedControl
      {...props}
      className={joinClassNames("lnr-segmented-toggle", className)}
      classNames={{
        ...classNames,
        control: joinClassNames(
          "lnr-segmented-toggle-control",
          classNames?.control,
        ),
        indicator: joinClassNames(
          "lnr-segmented-toggle-indicator",
          classNames?.indicator,
        ),
        label: joinClassNames(
          "lnr-segmented-toggle-label",
          classNames?.label,
        ),
      }}
      size="xs"
    />
  );
}
