/** The report being built: scripts/build.mjs aliases it to one file under src/<family>/. */
declare module "@report" {
  import type { JSX } from "react";

  export const title: string;
  export default function Report(): JSX.Element;
}
