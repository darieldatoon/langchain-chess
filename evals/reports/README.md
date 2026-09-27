# evals/reports

Dated, static HTML reports of experiments, built with Macaw and `chess-ui`. Open any `.html`
file here straight from disk: JavaScript, CSS and fonts are inlined, and it follows the system's
light or dark theme.

| Path                                | What it is                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/experiments/<date>-<name>.tsx` | An experiment report: its data as constants at the top, the page below                                          |
| `src/components/`                   | Shared pieces: `ReportHeader`, `Section`, `Answer`, `MetricCard`, `RunBarChart`, `DataTable`, `PositionExample` |
| `experiments/`                      | The built pages, committed                                                                                      |

## Write a report

1. Create `src/experiments/<date>-<name>.tsx`. Export `title` and a default component.
2. Gather the data however you like (LangSmith, a run directory) and paste it in as constants at
   the top. Compute every figure on the page from those constants; don't type numbers into prose.
   Say where the data came from, and link the source.
3. Build and commit both files:

   ```sh
   pnpm --dir evals/reports build            # reports not built yet
   pnpm --dir evals/reports build baseline   # reports whose name contains "baseline", rebuilt
   ```

A report is a snapshot: nothing regenerates it, and later runs get a new report rather than an
edited one.

Report pages are excluded from the coverage gate; `tests/reports.test.tsx` checks that each one
renders. The shared components are tested at 100%.
