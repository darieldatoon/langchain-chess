import { Button } from "@langchain/macaw-components/Button";
import { Kbd, KbdGroup } from "@langchain/macaw-components/Kbd";
import { Text } from "@langchain/macaw-components/Text";
import { TOUCH_TARGET } from "../touch";
import { ResponsiveDialog } from "./ResponsiveDialog";

const KEYS: readonly [readonly string[], string][] = [
  [["←", "k"], "Previous move"],
  [["→", "j"], "Next move"],
  [["Home", "↑"], "First move"],
  [["End", "↓"], "Last move"],
  [["f"], "Flip the board"],
  [["?"], "This list"],
];

/** The keys `useGameKeys` listens for. */
export function ShortcutDialog({ onClose }: { onClose: () => void }) {
  return (
    <ResponsiveDialog
      title="Keyboard shortcuts"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <Button
            variant="outlined"
            color="secondary"
            size="md"
            className={TOUCH_TARGET}
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-space-4 gap-y-space-2">
        {KEYS.map(([keys, action]) => (
          <div key={action} className="contents">
            <dt>
              <KbdGroup>
                {keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-space-1">
                    {i > 0 && (
                      <Text variant="xs" color="tertiary" as="span">
                        or
                      </Text>
                    )}
                    <Kbd>{key}</Kbd>
                  </span>
                ))}
              </KbdGroup>
            </dt>
            <dd>
              <Text variant="sm" as="span">
                {action}
              </Text>
            </dd>
          </div>
        ))}
      </dl>
    </ResponsiveDialog>
  );
}
