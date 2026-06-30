import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { authenticate } from './middleware/auth.js';
import { tenantMiddleware } from './middleware/tenantGuard.js';
import { subscriptionGuard } from './middleware/subscriptionGuard.js';
import { requireSuperAdmin, requireRole } from './middleware/rbac.js';

import authRoutes from './modules/auth/auth.routes.js';
import saDashboardRoutes from './modules/superAdmin/dashboard/dashboard.routes.js';
import saInstituteRoutes from './modules/superAdmin/institute/institute.routes.js';
import saPlansRoutes from './modules/superAdmin/plans/plans.routes.js';
import saInvoiceRoutes from './modules/superAdmin/invoice/invoice.routes.js';
import saTicketRoutes from './modules/superAdmin/ticket/ticket.routes.js';
import studentsRoutes from './modules/students/students.routes.js';
import adminSubscriptionRoutes from './modules/admin/subscription/subscription.routes.js';
import adminDashboardRoutes from './modules/admin/dashboard/dashboard.routes.js';
import adminTicketsRoutes from './modules/admin/tickets/tickets.routes.js';
import adminAcademicRoutes from './modules/admin/academic/academic.routes.js';
import adminTeachersRoutes from './modules/admin/teachers/teachers.routes.js';
import adminExamsRoutes from './modules/admin/exams/exams.routes.js';
import adminResultsRoutes from './modules/admin/results/results.routes.js';
import adminAttendanceRoutes from './modules/admin/attendance/attendance.routes.js';
import adminFeesRoutes from './modules/admin/fees/fees.routes.js';
import teacherPortalRoutes from './modules/teacher/portal/portal.routes.js';
import studentPortalRoutes from './modules/student/portal/portal.routes.js';

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}));
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(apiLimiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const api = express.Router();

api.use('/auth', authRoutes);

api.use(authenticate);
api.use(tenantMiddleware);
api.use(subscriptionGuard);

api.use('/sa/dashboard', requireSuperAdmin, saDashboardRoutes);
api.use('/sa/institutes', requireSuperAdmin, saInstituteRoutes);
api.use('/sa/plans', requireSuperAdmin, saPlansRoutes);
api.use('/sa/invoices', requireSuperAdmin, saInvoiceRoutes);
api.use('/sa/tickets', requireSuperAdmin, saTicketRoutes);

api.use('/admin/dashboard', requireRole('INSTITUTE_ADMIN', 'ACCOUNTANT', 'HR', 'LIBRARIAN', 'RECEPTIONIST', 'STAFF'), adminDashboardRoutes);
api.use('/admin/subscription', requireRole('INSTITUTE_ADMIN'), adminSubscriptionRoutes);
api.use('/admin/tickets', requireRole('INSTITUTE_ADMIN', 'ACCOUNTANT', 'HR', 'LIBRARIAN', 'RECEPTIONIST', 'STAFF', 'TEACHER'), adminTicketsRoutes);
api.use('/admin/students', requireRole('INSTITUTE_ADMIN', 'RECEPTIONIST'), studentsRoutes);
api.use('/admin/academic', requireRole('INSTITUTE_ADMIN', 'RECEPTIONIST'), adminAcademicRoutes);
api.use('/admin/teachers', requireRole('INSTITUTE_ADMIN', 'HR'), adminTeachersRoutes);
api.use('/admin/exams', requireRole('INSTITUTE_ADMIN', 'TEACHER'), adminExamsRoutes);
api.use('/admin/results', requireRole('INSTITUTE_ADMIN', 'TEACHER'), adminResultsRoutes);
api.use('/admin/attendance', requireRole('INSTITUTE_ADMIN', 'TEACHER', 'RECEPTIONIST'), adminAttendanceRoutes);
api.use('/admin/fees', requireRole('INSTITUTE_ADMIN', 'ACCOUNTANT'), adminFeesRoutes);

api.use('/teacher', requireRole('TEACHER'), teacherPortalRoutes);
api.use('/student', requireRole('STUDENT'), studentPortalRoutes);

app.use(`/api/${env.apiVersion}`, api);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
