import { Link } from "@langchain/macaw-components/Link";
import type { ReactNode } from "react";

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noreferrer">
      {children}
    </Link>
  );
}
