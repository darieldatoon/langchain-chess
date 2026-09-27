import { Button } from "@langchain/macaw-components/Button";
import { Dialog, DialogContent } from "@langchain/macaw-components/Dialog";
import { Input } from "@langchain/macaw-components/Input";
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
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent title="Settings" description="Stored in this browser only.">
        <div className="flex flex-col gap-space-5">
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
          <div className="flex justify-end gap-space-2 border-t border-subtle pt-space-4">
            <Button variant="outlined" color="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button color="primary" size="md" onClick={() => onSave({ apiKey: apiKey.trim() })}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
