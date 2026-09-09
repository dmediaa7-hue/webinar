import { formatDateOnly, formatDateTime } from './constants';

const BRAND = [45, 140, 255];

async function createPdfBundle() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);
  return { jsPDF, autoTable };
}

function msToDuration(ms) {
  if (!ms || ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function buildAttendanceRows(attendance) {
  return attendance
    .slice()
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
    .map((a, i) => ({
      index: i + 1,
      date: formatDateOnly(a.joinedAt),
      name: a.displayName || 'Guest',
      role: a.isHost ? 'Host' : 'Participant',
      joined: formatDateTime(a.joinedAt),
      left: a.leftAt ? formatDateTime(a.leftAt) : 'Still present',
      duration: a.leftAt ? msToDuration(a.leftAt - a.joinedAt) : 'Ongoing',
      status: a.leftAt ? 'Left' : 'Present'
    }));
}

function sessionDateLabel(rows) {
  if (rows.length === 0) return formatDateOnly(Date.now());
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  return first === last ? first : `${first} – ${last}`;
}

function csvLine(fields) {
  return fields
    .map((f) => {
      const s = String(f ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    })
    .join(',');
}

export function buildAttendanceCSV({ attendance, roomName, roomId, hostName }) {
  const rows = buildAttendanceRows(attendance);
  const lines = [
    'Attendance Report',
    csvLine(['Meeting', roomName || `${roomId}'s Meeting`]),
    csvLine(['Meeting ID', roomId]),
    csvLine(['Host', hostName || '—']),
    csvLine(['Session date', sessionDateLabel(rows)]),
    csvLine(['Generated', formatDateTime(Date.now())]),
    csvLine(['Total participants', rows.length]),
    '',
    csvLine(['No.', 'Date', 'Participant Name', 'Role', 'Joined', 'Left', 'Duration', 'Status'])
  ];
  rows.forEach((r) => lines.push(csvLine([r.index, r.date, r.name, r.role, r.joined, r.left, r.duration, r.status])));
  return lines.join('\r\n');
}

export function downloadAttendanceCSV({ attendance, roomName, roomId, hostName }) {
  const csv = buildAttendanceCSV({ attendance, roomName, roomId, hostName });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `attendance-${roomId}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function drawPageFrame(doc, pageNumber, totalPages, roomName, generatedLabel) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  if (pageNumber > 1) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND);
    doc.text('ATTENDANCE REPORT', margin, 26);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140);
    doc.text(String(roomName || '').slice(0, 48), pageWidth - margin, 26, { align: 'right' });
  }

  const footerY = pageHeight - 30;
  doc.setDrawColor(222, 228, 236);
  doc.setLineWidth(0.5);
  doc.line(margin, footerY, pageWidth - margin, footerY);
  doc.setFontSize(8.5);
  doc.setTextColor(160);
  doc.text('Webinar · Attendance Report', margin, footerY + 12);
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth / 2, footerY + 12, { align: 'center' });
  doc.text(generatedLabel, pageWidth - margin, footerY + 12, { align: 'right' });
}

export async function generateAttendancePDF({ attendance, roomName, roomId, hostName }) {
  const { jsPDF, autoTable } = await createPdfBundle();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const rows = buildAttendanceRows(attendance);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const generatedAt = Date.now();
  const generatedLabel = `Generated ${formatDateTime(generatedAt)}`;

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 92, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255);
  doc.text('Attendance Report', margin, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(String(roomName || `${roomId}'s Meeting`).slice(0, 60), margin, 58);
  doc.setFontSize(9);
  doc.text(`Meeting ID: ${roomId}`, margin, 72);
  doc.text(generatedLabel, pageWidth - margin, 40, { align: 'right' });
  doc.text(`Host: ${hostName || '—'}`, pageWidth - margin, 54, { align: 'right' });

  doc.setFontSize(9.5);
  doc.setTextColor(100);
  doc.setFont('helvetica', 'bold');
  doc.text(`Session date: ${sessionDateLabel(rows)}`, margin, 108);
  doc.setFont('helvetica', 'normal');
  doc.text(`Total participants: ${rows.length}`, pageWidth - margin, 108, { align: 'right' });

  const body = rows.length
    ? rows.map((r) => [String(r.index), r.date, r.name, r.role, r.joined, r.left, r.duration, r.status])
    : [['', '', 'No attendance records yet', '', '', '', '', '']];

  autoTable(doc, {
    startY: 122,
    margin: { left: margin, right: margin, top: 36, bottom: 66 },
    head: [['No.', 'Date', 'Participant Name', 'Role', 'Joined', 'Left', 'Duration', 'Status']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: { top: 4, bottom: 4, left: 2, right: 2 },
      textColor: [50, 60, 75],
      lineColor: [222, 228, 236],
      lineWidth: 0.5
    },
    headStyles: {
      fillColor: BRAND,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left'
    },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 54.28 },
      2: { cellWidth: 96 },
      3: { cellWidth: 58 },
      4: { cellWidth: 88 },
      5: { cellWidth: 88 },
      6: { cellWidth: 52, halign: 'center' },
      7: { cellWidth: 53, halign: 'center' }
    },
    rowPageBreak: 'auto'
  });

  if (rows.length) {
    const summaryY = doc.lastAutoTable.finalY + 24;
    doc.setDrawColor(222, 228, 236);
    doc.setLineWidth(0.5);
    doc.line(margin, summaryY - 12, pageWidth - margin, summaryY - 12);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(70);
    const present = rows.filter((r) => r.status === 'Present').length;
    const left = rows.length - present;
    doc.text(`Total participants: ${rows.length}   ·   Present: ${present}   ·   Left: ${left}`, margin, summaryY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(160);
    doc.text('End of report', pageWidth - margin, summaryY, { align: 'right' });
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    drawPageFrame(doc, i, totalPages, roomName, generatedLabel);
  }

  return doc;
}

export async function downloadAttendancePDF({ attendance, roomName, roomId, hostName }) {
  const doc = await generateAttendancePDF({ attendance, roomName, roomId, hostName });
  doc.save(`attendance-${roomId}.pdf`);
}