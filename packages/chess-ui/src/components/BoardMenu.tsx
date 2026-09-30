import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@langchain/macaw-components/DropdownMenu";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Kbd } from "@langchain/macaw-components/Kbd";
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List";
import type { ReactNode } from "react";
import { TOUCH_TARGET } from "../touch";

interface Props {
  onFlip: () => void;
  onHelp: () => void;
  /** Phones only: first and last move, which their bar has no room for. */
  navigate?: { onGo: (index: number) => void; last: number };
  /** More groups, between Actions and Help (display, input, alerts, export). */
  children?: ReactNode;
}

const ITEM = TOUCH_TARGET;

/** `≡`: the board's actions and preferences, as Lichess's board menu has them. */
export function BoardMenu({ onFlip, onHelp, navigate, children }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={ListIcon}
          label="Board menu"
          size="md"
          variant="outlined"
          color="secondary"
          className={TOUCH_TARGET}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70dvh] min-w-56 overflow-y-auto">
        {navigate && (
          <>
            <MenuGroup label="Navigate">
              <DropdownMenuItem className={ITEM} onSelect={() => navigate.onGo(0)}>
                First move
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM} onSelect={() => navigate.onGo(navigate.last)}>
                Last move
              </DropdownMenuItem>
            </MenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <MenuGroup label="Actions">
          <DropdownMenuItem className={ITEM} onSelect={onFlip}>
            <span className="flex-1">Flip board</span>
            <Kbd>f</Kbd>
          </DropdownMenuItem>
        </MenuGroup>
        {children}
        <DropdownMenuSeparator />
        <MenuGroup label="Help">
          <DropdownMenuItem className={ITEM} onSelect={onHelp}>
            <span className="flex-1">Keyboard shortcuts</span>
            <Kbd>?</Kbd>
          </DropdownMenuItem>
        </MenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenuGroup aria-label={label}>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {children}
    </DropdownMenuGroup>
  );
}
