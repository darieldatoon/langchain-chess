import { Link } from "@langchain/macaw-components/Link";
import { Text } from "@langchain/macaw-components/Text";
import type { ReactNode } from "react";
import { ExternalLink } from "./ExternalLink";
import { Eyebrow } from "./Section";

interface Props {
  eyebrow: string;
  title: string;
  children: ReactNode;
  /** Where the results live, e.g. the LangSmith experiments. */
  links: readonly { href: string; label: string }[];
  linksLabel?: string;
  /** In-page anchors to the report's sections. */
  contents: readonly { id: string; label: string }[];
}

export function ReportHeader({ eyebrow, title, children, links, linksLabel, contents }: Props) {
  return (
    <header className="flex flex-col gap-space-5">
      <div className="flex flex-col gap-space-3">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text variant="h1">{title}</Text>
        <Text variant="body" className="text-secondary">
          {children}
        </Text>
        <div className="flex flex-wrap gap-x-space-4 gap-y-space-1 text-sm">
          {linksLabel && <span className="text-tertiary">{linksLabel}</span>}
          {links.map((l) => (
            <ExternalLink key={l.href} href={l.href}>
              {l.label}
            </ExternalLink>
          ))}
        </div>
      </div>
      <nav aria-label="Contents" className="flex flex-wrap gap-x-space-4 gap-y-space-1 text-sm">
        <span className="text-tertiary">Contents:</span>
        {contents.map((c) => (
          <Link key={c.id} href={`#${c.id}`}>
            {c.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** The page frame: width, padding and the gap between sections. */
export function ReportPage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-space-9 px-space-5 py-space-9">
      {children}
    </main>
  );
}
