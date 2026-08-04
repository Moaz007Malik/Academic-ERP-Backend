import PDFDocument from 'pdfkit';

function startPdf(res, filename) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

function header(doc, title) {
  doc.fontSize(18).font('Helvetica-Bold').text(title);
  doc.fontSize(9).font('Helvetica').fillColor('#666').text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1.2);
  doc.fillColor('#000');
}

export function renderOverviewPdf(res, data) {
  const doc = startPdf(res, 'overview-report.pdf');
  header(doc, 'Institute Overview Report');

  const rows = [
    ['Active Students', data.totalStudents],
    ['Active Teachers', data.totalTeachers],
    ['Academic Classes', data.totalClasses],
    ['Degree Programs', data.totalDegreePrograms],
    ['Individual Courses', data.totalIndividualCourses],
    ["Today's Attendance", data.attendanceTodayPct != null ? `${data.attendanceTodayPct}%` : 'No records'],
    ['Fees Collected (this month)', `${data.feesCollectedMonth.toLocaleString()} PKR`],
    ['Fees Pending', `${data.feesPending.toLocaleString()} PKR`],
    ['Last Exam Pass Rate', data.lastExam ? `${data.lastExam.passRate ?? '—'}% (${data.lastExam.name})` : 'No published exams'],
    ['Open Support Tickets', data.openTickets],
  ];

  doc.fontSize(11).font('Helvetica');
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').text(label, { continued: true, width: 300 });
    doc.font('Helvetica').text(`   ${value}`);
    doc.moveDown(0.4);
  }

  doc.end();
}

function table(doc, columns, rows) {
  const startX = doc.x;
  let y = doc.y;
  doc.fontSize(9).font('Helvetica-Bold');
  columns.forEach((c) => doc.text(c.label, startX + c.x, y, { width: c.width }));
  y += 16;
  doc.moveTo(startX, y - 4).lineTo(startX + columns.reduce((s, c) => s + c.width, 0), y - 4).strokeColor('#ccc').stroke();
  doc.font('Helvetica');

  for (const row of rows) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = doc.y;
    }
    columns.forEach((c) => doc.text(String(row[c.key] ?? ''), startX + c.x, y, { width: c.width }));
    y += 15;
  }
  doc.y = y;
}

export function renderFeesPdf(res, data) {
  const doc = startPdf(res, 'fees-report.pdf');
  header(doc, 'Fees Report');

  doc.fontSize(11).font('Helvetica-Bold').text(`Collected: ${data.totals.paidAmount.toLocaleString()} PKR    `, { continued: true });
  doc.font('Helvetica-Bold').text(`Pending: ${data.totals.dueAmount.toLocaleString()} PKR`);
  doc.moveDown(1);

  const ROW_LIMIT = 500;
  table(doc, [
    { key: 'rollNumber', label: 'Roll No.', x: 0, width: 60 },
    { key: 'student', label: 'Student', x: 60, width: 110 },
    { key: 'track', label: 'Track', x: 170, width: 80 },
    { key: 'fee', label: 'Fee', x: 250, width: 110 },
    { key: 'amount', label: 'Amount', x: 360, width: 60 },
    { key: 'status', label: 'Status', x: 420, width: 70 },
  ], data.rows.slice(0, ROW_LIMIT));

  if (data.rows.length > ROW_LIMIT) {
    doc.moveDown(1).fontSize(9).fillColor('#c00')
      .text(`Showing first ${ROW_LIMIT} of ${data.rows.length} records — use CSV export for the full list.`);
  }

  doc.end();
}
