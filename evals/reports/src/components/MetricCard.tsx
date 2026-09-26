import { Card } from "@langchain/macaw-components/Card";
import { MetricChart } from "@langchain/macaw-components/MetricChart";
import { Text } from "@langchain/macaw-components/Text";

interface Props {
  label: string;
  value: string;
  /** One line of context under the value. */
  hint?: string;
}

export function MetricCard({ label, value, hint }: Props) {
  return (
    <Card className="flex flex-col gap-space-1">
      <Text variant="xs" className="text-tertiary">
        {label}
      </Text>
      <MetricChart value={value} size="md" />
      {hint && (
        <Text variant="xs" className="text-tertiary">
          {hint}
        </Text>
      )}
    </Card>
  );
}
