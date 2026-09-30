import { Button } from "@langchain/macaw-components/Button";
import { ResponsiveDialog, TOUCH_TARGET } from "@langchain-chess/chess-ui";

interface Props {
  title: string;
  text: string;
  onClose: () => void;
}

/** Where a copy the browser refused goes: the text, selected, to copy by hand. */
export function ExportDialog({ title, text, onClose }: Props) {
  return (
    <ResponsiveDialog
      title={title}
      description="The browser didn't allow copying. Copy it from here."
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
      {/* Native: Macaw's Textarea has no read-only mode. */}
      <textarea
        aria-label={title}
        value={text}
        readOnly
        autoFocus
        rows={Math.min(16, text.split("\n").length + 1)}
        className="w-full rounded-md border border-default bg-surface-level-2 p-space-2 font-mono text-xs text-primary"
        onFocus={(event) => event.currentTarget.select()}
      />
    </ResponsiveDialog>
  );
}
