import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@langchain/macaw-components/Dialog";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactNode } from "react";
import { DIALOG_CLASSES, REGION_CLASSES } from "../dialog";
import { TOUCH_TARGET } from "../touch";

interface Props {
  title: string;
  description?: ReactNode;
  /** Absent when there is nothing to go back to: no Close, and Esc and the scrim do nothing. */
  onClose?: () => void;
  /** Outside the scrolling body, so it never scrolls away. */
  footer: ReactNode;
  children: ReactNode;
}

/**
 * Macaw's `Dialog` with our own header: its close button can't be sized for touch, so it is
 * off (`showClose={false}`) and this renders its own.
 */
export function ResponsiveDialog({ title, description, onClose, footer, children }: Props) {
  return (
    <Dialog open onOpenChange={() => onClose?.()}>
      <DialogContent
        showClose={false}
        className={DIALOG_CLASSES}
        childrenClassName={REGION_CLASSES}
      >
        <div
          data-region="header"
          className="flex shrink-0 items-start justify-between gap-space-4 p-space-4"
        >
          <div className="flex min-w-0 flex-col gap-space-1">
            <DialogTitle asChild>
              <Text variant="h3" weight="semibold">
                {title}
              </Text>
            </DialogTitle>
            {description && (
              <DialogDescription asChild>
                <Text variant="sm" className="text-quaternary">
                  {description}
                </Text>
              </DialogDescription>
            )}
          </div>
          {onClose && (
            <IconButton
              icon={XIcon}
              label="Close"
              color="secondary"
              variant="plain"
              size="md"
              className={cn("shrink-0", TOUCH_TARGET)}
              tooltipProps={{ disabled: true }}
              onClick={onClose}
            />
          )}
        </div>
        <div data-region="body" className="min-h-0 flex-1 overflow-auto px-space-4 pb-space-4">
          {children}
        </div>
        <div data-region="footer" className="shrink-0 border-t border-subtle p-space-4">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}
