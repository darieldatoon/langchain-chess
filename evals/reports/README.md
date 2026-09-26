# evals/reports

Dated, static HTML reports of experiments and tournaments, built with Macaw and `chess-ui`. Open
any `.html` file here straight from disk: JavaScript, CSS and fonts are inlined, and it follows
the system's light or dark theme.

| Path                                | What it is                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/experiments/<date>-<name>.tsx` | An experiment report: its data as constants at the top, the page below                                          |
| `src/tournaments/<date>-<name>.tsx` | A tournament report ([#13](https://github.com/darieldatoon/langchain-chess/issues/13))                          |
| `src/components/`                   | Shared pieces: `ReportHeader`, `Section`, `Answer`, `MetricCard`, `RunBarChart`, `DataTable`, `PositionExample` |
| `experiments/`, `tournaments/`      | The built pages, committed                                                                                      |

## Write a report

1. Create `src/experiments/<date>-<name>.tsx`. Export `title` and a default component.
2. Gather the data however you like (LangSmith, a run directory) and paste it in as constants at
   the top. Compute every figure on the page from those constants; don't type numbers into prose.
   Say where the data came from, and link the source.
3. Build and commit both files:

   ```sh
   pnpm --dir evals/reports build            # every report
   pnpm --dir evals/reports build baseline   # only reports whose name contains "baseline"
   ```

A report is a snapshot: nothing regenerates it, and later runs get a new report rather than an
edited one.

Report pages are excluded from the coverage gate; `tests/reports.test.tsx` checks that each one
renders. The shared components are tested at 100%.
