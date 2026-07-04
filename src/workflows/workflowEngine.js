import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { publishEvent } from '../events/eventBus.js';
import { DOMAIN_EVENTS } from '../events/domainEventTypes.js';

/** Built-in workflow templates — institutes can override via WorkflowDefinition.config */
export const WORKFLOW_TEMPLATES = {
  ADMISSION: {
    states: [
      { key: 'DRAFT', label: 'Draft', isInitial: true },
      { key: 'SUBMITTED', label: 'Submitted' },
      { key: 'REVIEW', label: 'Under Review' },
      { key: 'APPROVED', label: 'Approved', isTerminal: true },
      { key: 'REJECTED', label: 'Rejected', isTerminal: true },
    ],
    transitions: [
      { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', requiredRole: 'RECEPTIONIST' },
      { from: 'SUBMITTED', to: 'REVIEW', action: 'accept', requiredRole: 'INSTITUTE_ADMIN' },
      { from: 'REVIEW', to: 'APPROVED', action: 'approve', requiredRole: 'INSTITUTE_ADMIN', escalationHours: 48 },
      { from: 'REVIEW', to: 'REJECTED', action: 'reject', requiredRole: 'INSTITUTE_ADMIN' },
    ],
  },
  LEAVE: {
    states: [
      { key: 'PENDING', label: 'Pending', isInitial: true },
      { key: 'MANAGER_REVIEW', label: 'Manager Review' },
      { key: 'HR_REVIEW', label: 'HR Review' },
      { key: 'APPROVED', label: 'Approved', isTerminal: true },
      { key: 'REJECTED', label: 'Rejected', isTerminal: true },
    ],
    transitions: [
      { from: 'PENDING', to: 'MANAGER_REVIEW', action: 'submit' },
      { from: 'MANAGER_REVIEW', to: 'HR_REVIEW', action: 'forward', requiredRole: 'HR', escalationHours: 24 },
      { from: 'HR_REVIEW', to: 'APPROVED', action: 'approve', requiredRole: 'HR' },
      { from: 'HR_REVIEW', to: 'REJECTED', action: 'reject', requiredRole: 'HR' },
    ],
  },
  SALARY: {
    states: [
      { key: 'DRAFT', label: 'Draft', isInitial: true },
      { key: 'FINANCE_REVIEW', label: 'Finance Review' },
      { key: 'ADMIN_APPROVAL', label: 'Admin Approval' },
      { key: 'PAID', label: 'Paid', isTerminal: true },
    ],
    transitions: [
      { from: 'DRAFT', to: 'FINANCE_REVIEW', action: 'submit', requiredRole: 'ACCOUNTANT' },
      { from: 'FINANCE_REVIEW', to: 'ADMIN_APPROVAL', action: 'verify', requiredRole: 'ACCOUNTANT', escalationHours: 72 },
      { from: 'ADMIN_APPROVAL', to: 'PAID', action: 'approve', requiredRole: 'INSTITUTE_ADMIN' },
    ],
  },
  CERTIFICATE: {
    states: [
      { key: 'REQUESTED', label: 'Requested', isInitial: true },
      { key: 'VERIFIED', label: 'Verified' },
      { key: 'ISSUED', label: 'Issued', isTerminal: true },
    ],
    transitions: [
      { from: 'REQUESTED', to: 'VERIFIED', action: 'verify', requiredRole: 'RECEPTIONIST' },
      { from: 'VERIFIED', to: 'ISSUED', action: 'issue', requiredRole: 'INSTITUTE_ADMIN' },
    ],
  },
  EXPENSE: {
    states: [
      { key: 'SUBMITTED', label: 'Submitted', isInitial: true },
      { key: 'APPROVED', label: 'Approved', isTerminal: true },
      { key: 'REJECTED', label: 'Rejected', isTerminal: true },
    ],
    transitions: [
      { from: 'SUBMITTED', to: 'APPROVED', action: 'approve', requiredRole: 'ACCOUNTANT', escalationHours: 48 },
      { from: 'SUBMITTED', to: 'REJECTED', action: 'reject', requiredRole: 'ACCOUNTANT' },
    ],
  },
  PURCHASE: {
    states: [
      { key: 'DRAFT', label: 'Draft', isInitial: true },
      { key: 'APPROVAL', label: 'Pending Approval' },
      { key: 'ORDERED', label: 'Ordered', isTerminal: true },
    ],
    transitions: [
      { from: 'DRAFT', to: 'APPROVAL', action: 'submit' },
      { from: 'APPROVAL', to: 'ORDERED', action: 'approve', requiredRole: 'INSTITUTE_ADMIN', escalationHours: 96 },
    ],
  },
  STUDENT_TRANSFER: {
    states: [
      { key: 'REQUESTED', label: 'Requested', isInitial: true },
      { key: 'APPROVED', label: 'Approved', isTerminal: true },
      { key: 'REJECTED', label: 'Rejected', isTerminal: true },
    ],
    transitions: [
      { from: 'REQUESTED', to: 'APPROVED', action: 'approve', requiredRole: 'INSTITUTE_ADMIN' },
      { from: 'REQUESTED', to: 'REJECTED', action: 'reject', requiredRole: 'INSTITUTE_ADMIN' },
    ],
  },
};

export async function ensureWorkflowDefinition(instituteId, workflowType) {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { instituteId, workflowType, isActive: true },
    include: { states: true, transitions: true },
  });
  if (existing) return existing;

  const template = WORKFLOW_TEMPLATES[workflowType];
  if (!template) throw new AppError(`Unknown workflow type: ${workflowType}`, 400);

  return prisma.$transaction(async (tx) => {
    const def = await tx.workflowDefinition.create({
      data: {
        instituteId,
        workflowType,
        name: `${workflowType} Workflow`,
        version: 1,
        isActive: true,
      },
    });
    for (const [i, s] of template.states.entries()) {
      await tx.workflowState.create({
        data: { definitionId: def.id, ...s, sortOrder: i },
      });
    }
    for (const t of template.transitions) {
      await tx.workflowTransition.create({
        data: {
          definitionId: def.id,
          fromStateKey: t.from,
          toStateKey: t.to,
          action: t.action,
          requiredRole: t.requiredRole || null,
          escalationHours: t.escalationHours || null,
          conditions: t.conditions || null,
        },
      });
    }
    return tx.workflowDefinition.findUnique({
      where: { id: def.id },
      include: { states: true, transitions: true },
    });
  });
}

export async function startWorkflow({
  instituteId,
  workflowType,
  entityType,
  entityId,
  initiatedById,
  metadata = {},
}) {
  const definition = await ensureWorkflowDefinition(instituteId, workflowType);
  const initial = definition.states.find((s) => s.isInitial);
  if (!initial) throw new AppError('Workflow has no initial state', 500);

  const instance = await prisma.workflowInstance.create({
    data: {
      instituteId,
      definitionId: definition.id,
      workflowType,
      entityType,
      entityId,
      currentState: initial.key,
      status: 'IN_PROGRESS',
      initiatedById,
      metadata,
    },
  });

  await prisma.workflowAuditLog.create({
    data: {
      instanceId: instance.id,
      toState: initial.key,
      action: 'start',
      actorId: initiatedById,
    },
  });

  return instance;
}

export async function transitionWorkflow({
  instanceId,
  action,
  actorId,
  actorRole,
  comments = null,
}) {
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { definition: { include: { transitions: true, states: true } } },
  });
  if (!instance) throw new AppError('Workflow instance not found', 404);
  if (instance.status !== 'IN_PROGRESS') throw new AppError('Workflow is not active', 400);

  const transition = instance.definition.transitions.find(
    (t) => t.fromStateKey === instance.currentState && t.action === action
  );
  if (!transition) throw new AppError(`Invalid action "${action}" from state ${instance.currentState}`, 400);

  if (transition.requiredRole && actorRole !== transition.requiredRole && actorRole !== 'INSTITUTE_ADMIN') {
    throw new AppError(`Role ${transition.requiredRole} required for this action`, 403);
  }

  const targetState = instance.definition.states.find((s) => s.key === transition.toStateKey);
  const isTerminal = targetState?.isTerminal;
  const newStatus = targetState?.key === 'REJECTED' ? 'REJECTED' : isTerminal ? 'APPROVED' : 'IN_PROGRESS';

  const dueAt = transition.escalationHours
    ? new Date(Date.now() + transition.escalationHours * 3600000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const inst = await tx.workflowInstance.update({
      where: { id: instanceId },
      data: {
        currentState: transition.toStateKey,
        status: newStatus,
        ...(isTerminal && { completedAt: new Date() }),
      },
    });
    await tx.workflowApproval.create({
      data: {
        instanceId,
        stepKey: transition.toStateKey,
        approverId: actorId,
        decision: newStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED',
        comments,
        decidedAt: new Date(),
        dueAt,
      },
    });
    await tx.workflowAuditLog.create({
      data: {
        instanceId,
        fromState: instance.currentState,
        toState: transition.toStateKey,
        action,
        actorId,
      },
    });
    return inst;
  });

  await publishEvent({
    eventType: DOMAIN_EVENTS.WORKFLOW_TRANSITION,
    aggregateType: 'WorkflowInstance',
    aggregateId: instanceId,
    instituteId: instance.instituteId,
    payload: { action, from: instance.currentState, to: transition.toStateKey, actorId },
  });

  return updated;
}

/** Escalation cron: mark overdue approvals as ESCALATED */
export async function processEscalations() {
  const overdue = await prisma.workflowApproval.findMany({
    where: {
      decision: 'PENDING',
      dueAt: { lt: new Date() },
    },
    take: 100,
  });
  for (const approval of overdue) {
    await prisma.workflowApproval.update({
      where: { id: approval.id },
      data: { decision: 'ESCALATED', escalatedAt: new Date() },
    });
    await prisma.workflowInstance.update({
      where: { id: approval.instanceId },
      data: { status: 'ESCALATED' },
    });
  }
  return overdue.length;
}
