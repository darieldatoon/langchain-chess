import { Render } from "./Render";
import { isEmbedded, useParentMessage } from "./useParentMessage";

export function RenderApp() {
  return <Render shown={useParentMessage()} embedded={isEmbedded()} />;
}
