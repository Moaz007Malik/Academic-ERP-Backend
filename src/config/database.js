import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

export const tenantContext = new AsyncLocalStorage();

const TENANT_MODELS = new Set([
  'Student', 'Teacher', 'Department', 'Course', 'Subject', 'Batch', 'Section',
  'Session', 'Semester', 'Attendance', 'Fee', 'FeeStructure', 'Result', 'Exam',
  'Timetable', 'Assignment', 'Submission', 'TeacherAssignment', 'LibraryBook', 'LibraryIssue',
  'HostelRoom', 'HostelAllotment', 'TransportRoute', 'TransportAllotment',
  'Notification', 'Announcement', 'CardDesign', 'Certificate', 'LoginHistory',
  'Salary', 'LeaveRequest', 'InventoryItem', 'SupportTicket', 'AuditLog',
  'User',
]);

const READ_OPS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy']);
const WRITE_WHERE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

function applyTenantFilter(model, operation, args) {
  const ctx = tenantContext.getStore();
  if (!ctx || ctx.bypassTenant || !TENANT_MODELS.has(model) || !ctx.instituteId) {
    return args;
  }

  const next = { ...args };

  if (READ_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) {
    next.where = { ...(next.where || {}) };
    if (next.where.instituteId === undefined) {
      next.where.instituteId = ctx.instituteId;
    }
  }

  if (operation === 'create' && next.data) {
    next.data = { ...next.data, instituteId: ctx.instituteId };
  }

  return next;
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(applyTenantFilter(model, operation, args));
        },
      },
    },
  });
}

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export function runWithTenant(instituteId, bypassTenant, fn) {
  return tenantContext.run({ instituteId, bypassTenant }, fn);
}
