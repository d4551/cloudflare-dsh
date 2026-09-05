/**
 * D1 query results.
 *
 * A real table, because a screen reader needs row and column relationships to
 * read a result set usefully: `<th scope="col">` headers, and a caption naming
 * the query the rows came from. The scroll container is focusable so a
 * keyboard user can reach a wide table's overflow (SC 2.1.1).
 */
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
  const rows = resultSets.flatMap((set) => set.results ?? [])
  const columns = columnsOf(rows)

  if (rows.length === 0 || columns.length === 0) {
    return <p className="cf-d1__empty">{en.toolView.emptyResult}</p>
  }

  return (
    // tabIndex makes the overflow reachable by keyboard; role="group" with a
    // name keeps that focus stop meaningful rather than an unlabelled target.
    <div className="cf-d1" tabIndex={0} role="group" aria-label={en.toolView.queryCaption(sql)}>
      <table>
        <caption>{en.toolView.queryCaption(sql)}</caption>
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
            // eslint-disable-next-line react/no-array-index-key
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{cellText(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
