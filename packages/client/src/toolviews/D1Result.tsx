/**
 * D1 query results.
 *
 * A real table, because a screen reader needs row and column relationships to
 * read a result set usefully: `<th scope="col">` headers, and a caption naming
 * the query the rows came from. The scroll container is focusable so a
 * keyboard user can reach a wide table's overflow (SC 2.1.1), and it is a
 * `<section>` taking its name from that caption by reference — an element
 * whose own semantics permit a name, and one statement of the query rather
 * than two.
 */
import { useId } from 'react'
import { en } from '../locales/en.ts'

/** One D1 result set, as the query endpoint returns it. */
export interface D1ResultSet {
  readonly results?: readonly Record<string, unknown>[]
}

/** Props for the result view. */
export interface D1ResultProps {
  readonly sql: string
  readonly resultSets: readonly D1ResultSet[]
}

/** Column names, in first-seen order across every row. */
export function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const seen: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key)
    }
  }
  return seen
}

/** Render one cell value as text. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function D1Result({ sql, resultSets }: D1ResultProps): React.JSX.Element {
  const captionId = useId()
  const rows = resultSets.flatMap((set) => set.results ?? [])
  const columns = columnsOf(rows)

  // No columns means nothing to render: `columnsOf` is empty both for no rows
  // and for rows that carry no fields, so this one check covers both.
  if (columns.length === 0) {
    return <p className="cf-d1__empty">{en.toolView.emptyResult}</p>
  }

  return (
    // tabIndex makes the overflow reachable by keyboard; the caption names the
    // focus stop, so it is meaningful rather than an unlabelled target.
    <section className="cf-d1" tabIndex={0} aria-labelledby={captionId}>
      <table>
        <caption id={captionId}>{en.toolView.queryCaption(sql)}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // Result rows have no stable identity, so the index is the key.
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{cellText(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
