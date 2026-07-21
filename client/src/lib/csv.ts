function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  downloadCsvRows(filename, [
    headers.map(csvCell).join(";"),
    ...rows.map((row) => row.map(csvCell).join(";")),
  ]);
}

export function downloadCsvRows(filename: string, rows: Array<unknown[] | string>) {
  const csv = rows
    .map((row) => Array.isArray(row) ? row.map(csvCell).join(";") : row)
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
