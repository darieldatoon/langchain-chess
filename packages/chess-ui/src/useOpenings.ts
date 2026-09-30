import { useEffect, useState } from "react";
import { loadOpenings, type OpeningTable } from "./openings";

/** The opening table once a game is on screen; null until it has loaded. */
export function useOpenings(active: boolean, load: () => Promise<OpeningTable> = loadOpenings) {
  const [table, setTable] = useState<OpeningTable | null>(null);
  useEffect(() => {
    if (!active || table) return;
    let current = true;
    void load().then((loaded) => current && setTable(loaded));
    return () => {
      current = false;
    };
  }, [active, table, load]);
  return table;
}
