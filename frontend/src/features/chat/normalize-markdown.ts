/** Recover PDF-extracted tables whose row newlines became spaces.
 * Only repair a line with an explicit Markdown separator row; never infer a
 * table from ordinary pipes, or rewrite code examples.
 */
export function normalizeMarkdownTables(content: string): string {
  let fence: { marker: string; length: number } | undefined
  return content
    .split('\n')
    .map((line) => {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
      if (fenceMatch) {
        const marker = fenceMatch[1]
        if (!fence) fence = { marker: marker[0], length: marker.length }
        else if (marker[0] === fence.marker && marker.length >= fence.length) fence = undefined
        return line
      }
      if (fence || line.includes('`') || /^(?: {4}|\t)/.test(line)) return line
      const rows = line.split(/(?<!\\)\|[ \t]+(?=\|)/).map((row, index, all) => (index < all.length - 1 ? `${row}|` : row))
      if (rows.length < 2) return line
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/(?<!\\)\|$/, '')
          .split(/(?<!\\)\|/)
      const isSeparator = (row: string) => {
        const values = cells(row)
        return values.length >= 2 && values.every((value) => /^\s*:?-{3,}:?\s*$/.test(value))
      }
      const separators = rows.flatMap((row, index) => (isSeparator(row) && index > 0 && cells(rows[index - 1]).length === cells(row).length ? [index] : []))
      if (!separators.length) return line

      const result: string[] = []
      const firstHeader = separators[0] - 1
      const prefix = rows.slice(0, firstHeader)
      if (prefix.length) {
        const width = cells(prefix[0]).length
        // A truncated preceding table can still have complete data rows. Keep
        // them as data, with empty headings rather than invented column names.
        if (width >= 2 && prefix.every((row) => cells(row).length === width && row.trimEnd().endsWith('|'))) {
          result.push(`|${' |'.repeat(width)}`, `|${' --- |'.repeat(width)}`, ...prefix.map((row) => (row.trimStart().startsWith('|') ? row : `|${row}`)), '')
        } else result.push(prefix.join('\n'), '')
      }
      for (let i = firstHeader; i < rows.length; i++) {
        if (i > firstHeader && separators.includes(i + 1)) result.push('')
        result.push(rows[i])
      }
      return result.join('\n')
    })
    .join('\n')
}
