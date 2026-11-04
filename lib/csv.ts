// Quoting alone does not stop spreadsheets from evaluating an imported name as a formula.
export function csvCell(value:unknown):string{
  const text=String(value),safe=typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/.test(text)?`'${text}`:text;
  return `"${safe.replaceAll('"','""')}"`;
}
