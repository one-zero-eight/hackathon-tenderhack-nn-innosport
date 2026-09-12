function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
}

function isSeparator(row: string): boolean {
  const values = cells(row)
  return values.length >= 2 && values.every((value) => /^\s*:?-{3,}:?\s*$/.test(value))
}

function anonymousTable(rows: string[], minimumWidth = 2): string[] {
  // Missing headings cannot be recovered from a truncated PDF snippet. Keep
  // every cell under empty headings rather than guessing labels or losing data.
  const width = Math.max(minimumWidth, ...rows.map((row) => cells(row).length))
  return [`|${' |'.repeat(width)}`, `|${' --- |'.repeat(width)}`, ...rows.map((row) => `|${cells(row).join('|')}${'|'.repeat(width - cells(row).length + 1)}`)]
}

/** Recover flattened PDF table rows, including snippets missing their header.
 * Require an explicit Markdown separator, and leave code examples untouched.
 */
export function normalizeMarkdownTables(content: string): string {
  let fence: { marker: string; length: number } | undefined
  const lines = content.split('\n').map((line) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { marker: marker[0], length: marker.length }
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = undefined
      return { line, protected: true }
    }
    return { line, protected: !!fence || line.includes('`') || /^(?: {4}|\t)/.test(line) }
  })

  const expanded = lines.flatMap((entry) => {
    if (entry.protected) return [entry]
    // PDF line-break tags are text separators, not executable HTML.
    const text = entry.line.replace(/<br\s*\/?\s*>/gi, ' ')
    const rows = text.split(/(?<!\\)\|[ \t]+(?=\|)/).map((row, index, all) => (index < all.length - 1 ? `${row}|` : row))
    if (rows.length < 2 || !rows.some(isSeparator)) return [{ ...entry, line: text }]
    return rows.map((line) => ({ line, protected: false }))
  })
  const result: string[] = []
  for (let i = 0; i < expanded.length; i++) {
    const entry = expanded[i]
    if (entry.protected || !isSeparator(entry.line)) {
      result.push(entry.line)
      continue
    }
    const previous = expanded[i - 1]
    const hasHeader = previous && !previous.protected && !isSeparator(previous.line) && cells(previous.line).length === cells(entry.line).length
    if (hasHeader) {
      const header = result.pop()!
      // Separate adjacent tables (or a preceding headerless table fragment).
      const prefix: string[] = []
      while (result.length && result[result.length - 1].trimEnd().endsWith('|') && cells(result[result.length - 1]).length >= 2 && !isSeparator(result[result.length - 1])) prefix.unshift(result.pop()!)
      if (prefix.length && !result.some(isSeparator)) result.push(...anonymousTable(prefix), '')
      else result.push(...prefix)
      if (result.length && result[result.length - 1].trim()) result.push('')
      result.push(header, entry.line)
      continue
    }
    const body: string[] = []
    while (i + 1 < expanded.length && !expanded[i + 1].protected && /^\s*\|/.test(expanded[i + 1].line)) {
      if (isSeparator(expanded[i + 1].line) || (expanded[i + 2] && isSeparator(expanded[i + 2].line))) break
      body.push(expanded[++i].line)
    }
    if (result.length && result[result.length - 1].trim()) result.push('')
    result.push(...anonymousTable(body, cells(entry.line).length), '')
  }
  return result.join('\n')
}
