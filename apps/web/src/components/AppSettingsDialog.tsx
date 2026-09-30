import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { ResponsiveDialog, TOUCH_TARGET } from "@langchain-chess/chess-ui";
import { useState } from "react";
import type { AppSettings } from "../storage";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

/** App-level settings only; the opponent is chosen per game in the new-game dialog. Mounted only
 * while shown, so each opening starts from the saved settings. */
export function AppSettingsDialog({ settings, onSave, onClose }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  return (
    <ResponsiveDialog
      title="Settings"
      description="Stored in this browser only."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-space-2">
          <Button
            variant="outlined"
            color="secondary"
            size="md"
            className={TOUCH_TARGET}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            size="md"
            className={TOUCH_TARGET}
            onClick={() => onSave({ apiKey: apiKey.trim() })}
          >
            Save
          </Button>
        </div>
      }
    >
      <Input
        id="api-key"
        size="md"
        type="password"
        label="LangSmith API Key"
        value={apiKey}
        onChange={setApiKey}
        placeholder="lsv2_..."
        hintText="Needed for a deployed server. Not needed against langgraph dev."
      />
    </ResponsiveDialog>
  );
}
