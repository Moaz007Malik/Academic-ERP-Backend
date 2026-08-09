import PDFDocument from 'pdfkit';

const PAYMENT_METHOD_LABELS = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  CARD: 'Card',
  ONLINE: 'Online',
  CHEQUE: 'Cheque',
};

async function fetchLogoBuffer(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

function row(doc, label, value, { bold = false, x = 50 } = {}) {
  const width = 495;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
  const y = doc.y;
  doc.fillColor('#555').text(label, x, y, { width: width * 0.4, continued: false });
  doc.fillColor('#111').text(value, x + width * 0.4, y, { width: width * 0.6, align: 'right' });
  doc.moveDown(0.5);
}

/** Serves as both "download" and "reprint" — reads already-persisted Fee data, so calling it
 * again for a past payment produces an identical PDF with no separate reprint code path. */
export async function renderFeeReceiptPdf(res, { fee, student, institute, collectedByName, degreeInfo }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${fee.receiptNumber || fee.id}.pdf"`);
  doc.pipe(res);

  const logoBuffer = institute?.logo ? await fetchLogoBuffer(institute.logo) : null;
  const textX = logoBuffer ? 120 : 50;
  if (logoBuffer) {
    try { doc.image(logoBuffer, 50, 45, { width: 60, height: 60, fit: [60, 60] }); } catch { /* corrupt/unsupported image, skip */ }
  }

  doc.fontSize(16).font('Helvetica-Bold').fillColor('#111').text(institute?.name || 'Institute', textX, 50, { width: 495 - (textX - 50) });
  const contactLine = [institute?.address, institute?.phone, institute?.email].filter(Boolean).join('  ·  ');
  if (contactLine) {
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(contactLine, textX, 72, { width: 495 - (textX - 50) });
  }

  doc.y = 130;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(1);

  doc.fontSize(14).font('Helvetica-Bold').fillColor('#111').text('Fee Payment Receipt', 50, doc.y, { width: 495, align: 'center' });
  doc.moveDown(1.5);

  const payable = Math.max(0, Number(fee.amount || 0) + Number(fee.fine || 0) - Number(fee.discount || 0));

  row(doc, 'Receipt No.', fee.receiptNumber || '—', { bold: true });
  row(doc, 'Student Name', `${student.firstName} ${student.lastName}`);
  row(doc, 'Student ID / Roll No.', student.rollNumber || '—');
  if (degreeInfo) {
    row(doc, 'Degree', degreeInfo.degreeName || '—');
    row(doc, 'Semester', degreeInfo.semesterNumber != null ? `Semester ${degreeInfo.semesterNumber}` : '—');
  }
  row(doc, 'Fee Type', `${fee.feeStructure?.name || '—'}${fee.installmentNo ? ` (Installment ${fee.installmentNo})` : ''}`);
  row(doc, 'Payment Date', fee.paidDate ? new Date(fee.paidDate).toLocaleDateString() : '—');
  row(doc, 'Payment Method', PAYMENT_METHOD_LABELS[fee.paymentMethod] || 'Not recorded');
  if (fee.transactionId) row(doc, 'Transaction ID', fee.transactionId);

  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#eee').stroke();
  doc.moveDown(0.5);

  row(doc, 'Original Amount', `${Number(fee.amount || 0).toLocaleString()} PKR`);
  if (Number(fee.discount || 0) > 0) row(doc, 'Discount', `- ${Number(fee.discount).toLocaleString()} PKR`);
  if (Number(fee.fine || 0) > 0) row(doc, 'Fine', `+ ${Number(fee.fine).toLocaleString()} PKR`);

  const remainingDue = fee.status === 'PARTIAL' ? payable : 0;
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#111').lineWidth(1.5).stroke();
  doc.moveDown(0.4);
  row(doc, 'Amount Paid', `${payable.toLocaleString()} PKR`, { bold: true });
  if (remainingDue > 0) row(doc, 'Remaining Balance', `${remainingDue.toLocaleString()} PKR`);

  doc.moveDown(2);
  row(doc, 'Collected By', collectedByName || '—');

  doc.moveDown(3);
  doc.fontSize(9).font('Helvetica').fillColor('#999')
    .text('Authorized Signature: ____________________________', 50, doc.y);
  doc.moveDown(2);
  doc.text('Computer-generated receipt — valid without a physical signature.', 50, doc.y, { width: 495, align: 'center' });

  doc.end();
}
