_Worked example: a fictional request planned against a generic repository. Italic lines are commentary; everything else is the artifact shape to copy._

# Add CSV export to the nightly report job

Source: `specs/csv-export.md` · baseline `a726c97` · **Proposal, not implemented.**

Adds a CSV writer beside the existing JSON output and calls it from the job's run step. Aggregation, its row shape, the JSON file, and the CLI flags stay unchanged. Caveat: quoting policy for embedded newlines is undecided; the writer assumes Python's default `csv` dialect.

## File tree

- <details open>
  <summary><code>src/</code></summary>

    - <details open>
      <summary><code>reports/</code></summary>

        - **`export.py`** — Write CSV rows behind one header.

          <details open>
          <summary aria-label="Toggle changes for src/reports/export.py"></summary>

            ```diff
            +# Proposed new file.
            +def write_csv(rows: list[Row], path: Path) -> None:
            +    # Unresolved: quote policy for embedded newlines.
            +    writer = csv.writer(path.open("w", newline=""))
            +    writer.writerow(field.name for field in Row.fields)
            +    writer.writerows(rows)
            ```

          </details>

        - **`job.py`** — Call the writer after aggregation.

          <details>
          <summary aria-label="Toggle changes for src/reports/job.py"></summary>

            ```diff
             from reports.aggregate import aggregate
            +from reports.export import write_csv

            -def run(sources: list[Path]) -> Report:
            -    return Report(aggregate(sources))
            +def run(sources: list[Path], out_dir: Path) -> Report:
            +    report = Report(aggregate(sources))
            +    write_csv(report.rows, out_dir / "report.csv")
            +    return report
            ```

          </details>

        - **`aggregate.py`** — Retain the aggregation row shape.

          <details open>
          <summary aria-label="Toggle changes for src/reports/aggregate.py"></summary>

            ```diff
             def aggregate(sources: list[Path]) -> list[Row]:
                 # Unchanged: export consumes these rows as they are.
                 return [row for row in load(sources) if row.keep]
            ```

          </details>

      </details>

  </details>

- <details open>
  <summary><code>tests/</code></summary>

    - <details open>
      <summary><code>reports/</code></summary>

        - **`test_export.py`** — Cover header, quoting, and empty input.

          <details open>
          <summary aria-label="Toggle changes for tests/reports/test_export.py"></summary>

            ```diff
            +# Proposed tests; none pass yet.
            +def test_write_csv_quotes_embedded_commas(tmp_path):
            +    write_csv([Row(name="a,b")], tmp_path / "r.csv")
            +    assert (tmp_path / "r.csv").read_text() == "name\na,b\n"
            +
            +def test_write_csv_empty_report_writes_header(tmp_path):
            +    write_csv([], tmp_path / "r.csv")
            +    assert (tmp_path / "r.csv").read_text() == "name\n"
            ```

          </details>

      </details>

  </details>

- <details open>
  <summary><code>docs/</code></summary>

    - **`reports.md`** — Document the new CSV output.

      <details open>
      <summary aria-label="Toggle changes for docs/reports.md"></summary>

        ```diff
        -Outputs: `summary.json` in the output directory.
        +Outputs: `summary.json` and `report.csv` in the output directory.
        ```

      </details>

  </details>

_Rendering check: `job.py` is the only body that starts collapsed — expand it to test disclosure. `export.py` marks a proposed added file inside its body, `aggregate.py` shows an unchanged anchor, and `test_export.py` labels its tests as proposed. With folding ignored, the tree still reads as filenames plus headlines._
