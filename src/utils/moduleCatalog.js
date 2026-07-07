import { MODULE_KEYS, CORE_MODULES } from './constants.js';

/** Full module catalogue aligned with SDD */
export const MODULE_CATALOG = [
  { key: MODULE_KEYS.STUDENT_MANAGEMENT, label: 'Student Management', category: 'Core', description: 'Students, enrollment, academic records' },
  { key: MODULE_KEYS.TEACHER_MANAGEMENT, label: 'Teacher Management', category: 'Core', description: 'Teachers, assignments, HR data' },
  { key: MODULE_KEYS.ATTENDANCE, label: 'Attendance', category: 'Core', description: 'Daily attendance marking and reports' },
  { key: MODULE_KEYS.FEES_FINANCE, label: 'Fee Management', category: 'Core', description: 'Fee structures, collection, installments' },
  { key: MODULE_KEYS.RESULTS_EXAMS, label: 'Examination & Results', category: 'Core', description: 'Exams, marks entry, result cards' },
  { key: MODULE_KEYS.TIMETABLE, label: 'Timetable', category: 'Academic', description: 'Class schedules and periods' },
  { key: MODULE_KEYS.STUDENT_PORTAL, label: 'Student Portal', category: 'Portals', description: 'Student login and self-service' },
  { key: MODULE_KEYS.PARENT_PORTAL, label: 'Parent Portal', category: 'Portals', description: 'Parent login and child monitoring' },
  { key: MODULE_KEYS.TEACHER_PORTAL, label: 'Teacher Portal', category: 'Portals', description: 'Teacher login and classroom tools' },
  { key: MODULE_KEYS.LIBRARY, label: 'Library', category: 'Operations', description: 'Books, issues, returns' },
  { key: MODULE_KEYS.HOSTEL, label: 'Hostel', category: 'Operations', description: 'Hostel rooms and allotments' },
  { key: MODULE_KEYS.TRANSPORT, label: 'Transport', category: 'Operations', description: 'Routes and transport fees' },
  { key: MODULE_KEYS.HR_PAYROLL, label: 'HR & Payroll', category: 'Operations', description: 'Salaries, leave, payroll slips' },
  { key: MODULE_KEYS.ADMISSION, label: 'Admission', category: 'Academic', description: 'New admissions and inquiries' },
  { key: MODULE_KEYS.ASSIGNMENTS_QUIZ, label: 'Assignments & Quiz', category: 'Academic', description: 'Homework and online quizzes' },
  { key: MODULE_KEYS.LMS, label: 'LMS', category: 'Academic', description: 'Learning management content' },
  { key: MODULE_KEYS.CERTIFICATES, label: 'Certificates', category: 'Documents', description: 'Issue certificates and transcripts' },
  { key: MODULE_KEYS.ID_CARD_DESIGNER, label: 'Student ID Card', category: 'Documents', description: 'ID card design, print, QR' },
  { key: MODULE_KEYS.DOCUMENT_MANAGEMENT, label: 'Document Management', category: 'Documents', description: 'Upload and manage documents' },
  { key: MODULE_KEYS.SMS_NOTIFICATIONS, label: 'SMS Notifications', category: 'Communications', description: 'SMS alerts to parents/students' },
  { key: MODULE_KEYS.EMAIL_NOTIFICATIONS, label: 'Email Notifications', category: 'Communications', description: 'Email alerts and broadcasts' },
  { key: MODULE_KEYS.REPORTS, label: 'Reports', category: 'Analytics', description: 'Institute reports and analytics' },
  { key: MODULE_KEYS.TICKETS, label: 'Support Tickets', category: 'Support', description: 'Helpdesk and support requests' },
  { key: MODULE_KEYS.INVENTORY, label: 'Inventory', category: 'Operations', description: 'Stock and asset tracking' },
  { key: MODULE_KEYS.ONLINE_CLASSES, label: 'Online Classes', category: 'Academic', description: 'Virtual class sessions' },
  { key: MODULE_KEYS.ALUMNI, label: 'Alumni', category: 'Community', description: 'Alumni network' },
  { key: MODULE_KEYS.PLACEMENT, label: 'Placement', category: 'Community', description: 'Job placement tracking' },
  { key: MODULE_KEYS.RESEARCH, label: 'Research', category: 'Academic', description: 'Research projects' },
  { key: MODULE_KEYS.PROFILE_SETTINGS, label: 'Profile Settings', category: 'System', description: 'Institute profile and preferences' },
  { key: MODULE_KEYS.INDIVIDUAL_COURSES, label: 'Individual Courses', category: 'Academic', description: 'Short courses independent of class/batch system' },
  { key: MODULE_KEYS.DEGREE, label: 'Degree Programs', category: 'Academic', description: 'University degree batches, semesters, GPA and transcripts' },
];

export const ALL_MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);

export function getModuleMeta(key) {
  return MODULE_CATALOG.find((m) => m.key === key);
}

export function summarizeModules(activeModules = []) {
  const active = new Set(activeModules);
  const enabled = MODULE_CATALOG.filter((m) => active.has(m.key));
  const disabled = MODULE_CATALOG.filter((m) => !active.has(m.key));
  return {
    active: enabled,
    disabled,
    activeCount: enabled.length,
    disabledCount: disabled.length,
    totalCount: MODULE_CATALOG.length,
    remainingCount: MODULE_CATALOG.length - enabled.length,
  };
}

/** Portal login requires these modules */
export const PORTAL_MODULE_REQUIREMENTS = {
  STUDENT: MODULE_KEYS.STUDENT_PORTAL,
  PARENT: MODULE_KEYS.PARENT_PORTAL,
  TEACHER: MODULE_KEYS.TEACHER_PORTAL,
};

export function assertPortalModuleAccess(role, activeModules = []) {
  const required = PORTAL_MODULE_REQUIREMENTS[role];
  if (!required) return true;
  return activeModules.includes(required);
}

export { CORE_MODULES };
