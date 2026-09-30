import { Popover, PopoverContent, PopoverTrigger } from "@langchain/macaw-components/Popover";
import { Text } from "@langchain/macaw-components/Text";
import { Tooltip } from "@langchain/macaw-components/Tooltip";
import { cn } from "@langchain/macaw-components/utils/cn";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { useState, type ReactNode } from "react";
import { TOUCH_HIT_AREA } from "../touch";

interface Props {
  /** The trigger's accessible name. */
  label: string;
  text: ReactNode;
  /** What the trigger shows; an info icon by default. */
  children?: ReactNode;
  className?: string;
}

/**
 * Help that opens on click, tap, Enter or Space: a tooltip alone never opens on touch. Fine
 * pointers also get it on hover.
 */
export function Hint({ label, text, children, className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip title={text} disabled={open}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex items-center text-tertiary hover:text-primary",
              TOUCH_HIT_AREA,
              className,
            )}
          >
            {children ?? <InfoIcon aria-hidden size={14} />}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="max-w-xs p-space-3">
        <Text variant="sm">{text}</Text>
      </PopoverContent>
    </Popover>
  );
}
