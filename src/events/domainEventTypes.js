/**
 * Domain event type registry — extend when adding new business capabilities.
 * Events are persisted then processed asynchronously (BullMQ when enabled).
 */
export const DOMAIN_EVENTS = {
  STUDENT_CREATED: 'student.created',
  STUDENT_UPDATED: 'student.updated',
  STUDENT_TRANSFERRED: 'student.transferred',
  FEE_ASSIGNED: 'fee.assigned',
  FEE_COLLECTED: 'fee.collected',
  FEE_REQUEST_SUBMITTED: 'fee.request.submitted',
  RESULT_PUBLISHED: 'result.published',
  ATTENDANCE_MARKED: 'attendance.marked',
  TICKET_CREATED: 'ticket.created',
  TICKET_RESOLVED: 'ticket.resolved',
  SUBSCRIPTION_RENEWED: 'subscription.renewed',
  WORKFLOW_TRANSITION: 'workflow.transition',
  FORM_SUBMITTED: 'form.submitted',
  DOCUMENT_VERSIONED: 'document.versioned',
  USER_LOGIN_SUSPICIOUS: 'security.login.suspicious',
};

export const AGGREGATE_TYPES = {
  STUDENT: 'Student',
  FEE: 'Fee',
  RESULT: 'Result',
  ATTENDANCE: 'Attendance',
  TICKET: 'SupportTicket',
  INSTITUTE: 'Institute',
  WORKFLOW: 'WorkflowInstance',
  FORM: 'FormSubmission',
  DOCUMENT: 'DocumentVersion',
};
