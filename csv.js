/*
 * Small, dependency-free CSV reader.
 * Handles: a leading byte-order mark, quoted cells, "" for a quote inside a cell,
 * line breaks inside quoted cells, and Windows / Mac / Unix line endings.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  // Text -> array of rows, each row an array of strings. Blank lines are kept as
  // empty rows so row numbers match what you see in a spreadsheet.
  function parseRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    if (n && text.charCodeAt(0) === 0xfeff) i = 1;

    const endRow = () => { row.push(field); rows.push(row); row = []; field = ''; };

    for (; i < n; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        if (text[i + 1] === '\n') i++;
        endRow();
      } else if (c === '\n') {
        endRow();
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) endRow();
    return rows;
  }

  // Text -> { headers, records }. records[i].row is the spreadsheet row number
  // (the header is row 1), records[i].cells lines up with headers. Completely
  // empty rows are dropped.
  function parseCSV(text) {
    const rows = parseRows(String(text == null ? '' : text));
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map(h => h.trim());
    const records = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r].map(c => c.trim());
      if (cells.every(c => c === '')) continue;
      while (cells.length < headers.length) cells.push('');
      records.push({ row: r + 1, cells });
    }
    return { headers, records };
  }

  HH.csv = { parseRows, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.csv;
})();
