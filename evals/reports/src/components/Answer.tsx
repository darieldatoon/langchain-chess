import { Banner } from "@langchain/macaw-components/Banner";
import type { ReactNode } from "react";

/** The one-paragraph answer to a section's question. */
export function Answer({ children }: { children: ReactNode }) {
  return (
    <Banner intent="info" title="Answer">
      {children}
    </Banner>
  );
}
