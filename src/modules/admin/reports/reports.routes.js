import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { sendCsv } from '../../../utils/csvExport.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { getExamAnalytics } from '../../../services/result.service.js';
import {
  getOverviewReport, getStudentsReport, getTeachersReport, getAttendanceReport,
  getFeesReport, getSalaryReport, listExamsForReport,
} from '../../../services/reports.service.js';
import { renderOverviewPdf, renderFeesPdf } from '../../../services/reportPdf.service.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.REPORTS));
router.use(blockExpiredModuleAccess);

router.get('/overview', async (req, res, next) => {
  try {
    const data = await getOverviewReport(req.user.instituteId);
    if (req.query.format === 'pdf') return renderOverviewPdf(res, data);
    return success(res, data);
  } catch (err) { next(err); }
});

router.get('/students', async (req, res, next) => {
  try {
    const { classId, batchId, sectionId, status } = req.query;
    const rows = await getStudentsReport({ instituteId: req.user.instituteId, classId, batchId, sectionId, status });
    if (req.query.format === 'csv') {
      return sendCsv(res, 'students-report.csv', [
        { key: 'rollNumber', label: 'Roll No.' }, { key: 'name', label: 'Name' },
        { key: 'class', label: 'Class' }, { key: 'batch', label: 'Batch' }, { key: 'section', label: 'Section' },
        { key: 'status', label: 'Status' }, { key: 'guardianName', label: 'Guardian' }, { key: 'guardianPhone', label: 'Guardian Phone' },
      ], rows);
    }
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/teachers', async (req, res, next) => {
  try {
    const { departmentId, status } = req.query;
    const rows = await getTeachersReport({ instituteId: req.user.instituteId, departmentId, status });
    if (req.query.format === 'csv') {
      return sendCsv(res, 'teachers-report.csv', [
        { key: 'employeeCode', label: 'Employee Code' }, { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
        { key: 'status', label: 'Status' }, { key: 'assignmentsCount', label: 'Assignments' }, { key: 'salary', label: 'Salary' },
      ], rows);
    }
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const { track, sectionId, degreeCourseId, individualCourseId, dateFrom, dateTo } = req.query;
    const rows = await getAttendanceReport({ instituteId: req.user.instituteId, track, sectionId, degreeCourseId, individualCourseId, dateFrom, dateTo });
    if (req.query.format === 'csv') {
      return sendCsv(res, 'attendance-report.csv', [
        { key: 'rollNumber', label: 'Roll No.' }, { key: 'name', label: 'Name' },
        { key: 'total', label: 'Total' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' },
        { key: 'late', label: 'Late' }, { key: 'leave', label: 'Leave' }, { key: 'percentage', label: 'Percentage' },
      ], rows);
    }
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/fees', async (req, res, next) => {
  try {
    const { track, dateFrom, dateTo } = req.query;
    const data = await getFeesReport({ instituteId: req.user.instituteId, track, dateFrom, dateTo });
    if (req.query.format === 'pdf') return renderFeesPdf(res, data);
    if (req.query.format === 'csv') {
      return sendCsv(res, 'fees-report.csv', [
        { key: 'rollNumber', label: 'Roll No.' }, { key: 'student', label: 'Student' }, { key: 'track', label: 'Track' },
        { key: 'fee', label: 'Fee' }, { key: 'amount', label: 'Amount' }, { key: 'discount', label: 'Discount' },
        { key: 'fine', label: 'Fine' }, { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due Date' },
        { key: 'paidDate', label: 'Paid Date' }, { key: 'receiptNumber', label: 'Receipt No.' },
      ], data.rows);
    }
    return success(res, data);
  } catch (err) { next(err); }
});

router.get('/salary', async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const data = await getSalaryReport({ instituteId: req.user.instituteId, month, year });
    if (req.query.format === 'csv') {
      return sendCsv(res, 'salary-report.csv', [
        { key: 'employeeCode', label: 'Employee Code' }, { key: 'teacher', label: 'Teacher' },
        { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' }, { key: 'amount', label: 'Gross' },
        { key: 'deductions', label: 'Deductions' }, { key: 'netAmount', label: 'Net Pay' },
      ], data.rows);
    }
    return success(res, data);
  } catch (err) { next(err); }
});

router.get('/exams', async (req, res, next) => {
  try {
    const exams = await listExamsForReport(req.user.instituteId);
    return success(res, exams);
  } catch (err) { next(err); }
});

router.get('/exams/:examId', async (req, res, next) => {
  try {
    const data = await getExamAnalytics({ instituteId: req.user.instituteId, examId: req.params.examId });
    if (req.query.format === 'csv') {
      const rows = data.studentResults.map((s) => ({
        rollNumber: s.student.rollNumber,
        name: `${s.student.firstName} ${s.student.lastName}`,
        rank: s.rank,
        obtained: s.totalObtained,
        max: s.totalMax,
        percentage: s.percentage,
      }));
      return sendCsv(res, 'exam-results.csv', [
        { key: 'rank', label: 'Rank' }, { key: 'rollNumber', label: 'Roll No.' }, { key: 'name', label: 'Name' },
        { key: 'obtained', label: 'Obtained' }, { key: 'max', label: 'Max' }, { key: 'percentage', label: 'Percentage' },
      ], rows);
    }
    return success(res, data);
  } catch (err) { next(err); }
});

export default router;
