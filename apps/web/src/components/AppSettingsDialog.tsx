import { Button } from "@langchain/macaw-components/Button";
import { Text } from "@langchain/macaw-components/Text";
import { ResponsiveDialog, TOUCH_TARGET } from "@langchain-chess/chess-ui";
import type { Session } from "../auth/session";

interface Props {
  session: Session;
  onSignOut: () => void;
  onClose: () => void;
}

function describe(session: Session): string {
  switch (session.kind) {
    case "none":
      return "This server needs no sign-in.";
    case "apiKey":
      return "Signed in with a LangSmith API key. It stays in this tab only.";
    case "oauth":
      return session.email
        ? `Signed in with LangSmith as ${session.email}.`
        : "Signed in with LangSmith.";
  }
}

/** App-level settings only; the opponent is chosen per game in the new-game dialog. */
export function AppSettingsDialog({ session, onSignOut, onClose }: Props) {
  return (
    <ResponsiveDialog
      title="Settings"
      description="Your sign-in, for this tab."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-space-2">
          {session.kind !== "none" && (
            <Button
              variant="outlined"
              color="secondary"
              size="md"
              className={TOUCH_TARGET}
              onClick={onSignOut}
            >
              Sign out
            </Button>
          )}
          <Button color="primary" size="md" className={TOUCH_TARGET} onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <Text variant="body">{describe(session)}</Text>
    </ResponsiveDialog>
  );
}
