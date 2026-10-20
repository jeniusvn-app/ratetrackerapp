import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { toDMY } from '@/lib/format';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

interface ExportParams {
  hotelName: string;
  startDate: string; // ISO
  endDate: string; // ISO
  columns: ExportColumn[];
  rows: Record<string, string | number>[];
  filename: string;
}

function headerLines(p: ExportParams): string[] {
  return [
    (p.hotelName || '').toUpperCase(),
    'BÁO CÁO TRA CỨU GIÁ PHÒNG - RATETRACKER AI',
    `Giai đoạn: ${toDMY(p.startDate)} đến ${toDMY(p.endDate)}`,
  ];
}

export function exportExcel(p: ExportParams) {
  const wsData: (string | number)[][] = [];
  wsData.push(headerLines(p));
  wsData.push([]);
  wsData.push(p.columns.map((c) => c.header));
  for (const r of p.rows) wsData.push(p.columns.map((c) => r[c.key] ?? ''));

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = p.columns.map((c) => ({ wch: c.width || 18 }));
  // Merge title rows
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: p.columns.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: p.columns.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: p.columns.length - 1 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');

  const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arr], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, `${p.filename}.xlsx`);
}

export function exportCSV(p: ExportParams) {
  const lines: string[] = [];
  lines.push(headerLines(p).join(' | '));
  lines.push(p.columns.map((c) => `"${c.header}"`).join(','));
  for (const r of p.rows) {
    lines.push(
      p.columns
        .map((c) => {
          const v = r[c.key] ?? '';
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(','),
    );
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `${p.filename}.csv`);
}

export function exportPDF(p: ExportParams) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const lines = headerLines(p);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(lines[0], 40, 40);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(lines[1], 40, 58);
  doc.setFontSize(10);
  doc.text(lines[2], 40, 74);

  autoTable(doc, {
    startY: 90,
    head: [p.columns.map((c) => c.header)],
    body: p.rows.map((r) => p.columns.map((c) => String(r[c.key] ?? ''))),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [10, 25, 47], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  doc.save(`${p.filename}.pdf`);
}
