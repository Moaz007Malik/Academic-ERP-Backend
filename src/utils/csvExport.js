function csvField(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** columns: [{ key, label }]. Sends a CSV file as the HTTP response (opens directly in Excel). */
export function sendCsv(res, filename, columns, rows) {
  const header = columns.map((c) => csvField(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvField(row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
}
