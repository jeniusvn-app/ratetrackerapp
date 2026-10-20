import { useState } from 'react';
import { Modal, Button, Field, Select } from '@/components/ui';
import { exportExcel, exportCSV, exportPDF, type ExportColumn } from '@/lib/export';

interface Props {
  open: boolean;
  onClose: () => void;
  hotelName: string;
  defaultStart: string;
  defaultEnd: string;
  columns: ExportColumn[];
  rows: Record<string, string | number>[];
  filename: string;
}

export function ExportModal({
  open,
  onClose,
  hotelName,
  defaultStart,
  defaultEnd,
  columns,
  rows,
  filename,
}: Props) {
  const [format, setFormat] = useState('xlsx');

  const doExport = () => {
    const params = {
      hotelName,
      startDate: defaultStart,
      endDate: defaultEnd,
      columns,
      rows,
      filename,
    };
    if (format === 'xlsx') exportExcel(params);
    else if (format === 'csv') exportCSV(params);
    else exportPDF(params);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Xuất dữ liệu" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="rounded-lg bg-navy-50 border border-navy-100 p-3 text-xs text-navy-600 space-y-0.5">
          <div>
            <span className="font-semibold">Khách sạn:</span> {hotelName || '—'}
          </div>
          <div>
            <span className="font-semibold">Giai đoạn:</span> {defaultStart} → {defaultEnd}
          </div>
          <div>
            <span className="font-semibold">Số dòng:</span> {rows.length}
          </div>
        </div>
        <Field label="Định dạng tập tin">
          <Select value={format} onChange={setFormat}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="pdf">PDF (.pdf)</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="gold" onClick={doExport}>
            Tải tập tin
          </Button>
        </div>
      </div>
    </Modal>
  );
}
