import { useColorScheme } from "@langchain/macaw-components/hooks/useColorScheme";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";

export function ThemeToggle() {
  const { isDarkMode, setMode } = useColorScheme();
  return (
    <IconButton
      variant="outlined"
      color="secondary"
      size="md"
      icon={isDarkMode ? SunIcon : MoonIcon}
      label={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setMode(isDarkMode ? "light" : "dark")}
    />
  );
}
