import { Text } from "@langchain/macaw-components/Text";
import { BookOpenIcon } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { openingTitle, type Opening } from "../openings";
import { Hint } from "./Hint";

/** The move list's first line: the opening's code and name, in full on hover or tap. */
export function OpeningHeading({ opening }: { opening: Opening | null }) {
  if (!opening) return null;
  const title = openingTitle(opening);
  return (
    <div className="flex min-w-0 px-space-2 pb-space-1" aria-label="opening">
      <Hint label={title} text={title} className="min-w-0 text-secondary">
        <Text variant="xs" color="secondary" as="span" className="truncate">
          {title}
        </Text>
      </Hint>
    </div>
  );
}

/** A book beside the move that reached the opening: its name on hover, click or tap. */
export function OpeningMark({ opening }: { opening: Opening }) {
  const title = openingTitle(opening);
  return (
    <Hint label={`Opening: ${title}`} text={title}>
      <BookOpenIcon aria-hidden size={12} />
    </Hint>
  );
}
