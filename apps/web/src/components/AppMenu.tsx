import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@langchain/macaw-components/DropdownMenu";
import { useColorScheme } from "@langchain/macaw-components/hooks/useColorScheme";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List";
import { TOUCH_TARGET } from "@langchain-chess/chess-ui";

/** Settings and the theme on phones, where the header has room for one button more. */
export function AppMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { isDarkMode, setMode } = useColorScheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="outlined"
          color="secondary"
          size="md"
          icon={ListIcon}
          label="App menu"
          className={TOUCH_TARGET}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className={TOUCH_TARGET} onSelect={onOpenSettings}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          className={TOUCH_TARGET}
          onSelect={() => setMode(isDarkMode ? "light" : "dark")}
        >
          {isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
