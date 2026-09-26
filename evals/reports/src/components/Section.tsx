import { Text } from "@langchain/macaw-components/Text";
import type { ReactNode } from "react";

interface Props {
  id: string;
  /** Small label above the title, e.g. "Question 3". */
  eyebrow?: string;
  title: string;
  children: ReactNode;
}

export function Section({ id, eyebrow, title, children }: Props) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-space-4">
      <div className="flex flex-col gap-space-1">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Text variant="h2">{title}</Text>
      </div>
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text variant="xs" className="font-semibold tracking-wide text-tertiary uppercase">
      {children}
    </Text>
  );
}

/** Body copy in the report's secondary text colour. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <Text variant="body" className="text-secondary">
      {children}
    </Text>
  );
}
