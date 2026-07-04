import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { publishEvent } from '../events/eventBus.js';
import { DOMAIN_EVENTS } from '../events/domainEventTypes.js';

export async function createFormDefinition(instituteId, { name, purpose, slug, fields = [] }) {
  return prisma.$transaction(async (tx) => {
    const form = await tx.formDefinition.create({
      data: {
        instituteId,
        name,
        purpose,
        slug,
        version: 1,
        schema: { fields: fields.map((f) => f.fieldKey) },
      },
    });
    for (const [i, field] of fields.entries()) {
      await tx.formField.create({
        data: {
          formId: form.id,
          fieldKey: field.fieldKey,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required ?? false,
          options: field.options ?? null,
          validation: field.validation ?? null,
          sortOrder: field.sortOrder ?? i,
          conditions: field.conditions ?? null,
        },
      });
    }
    return tx.formDefinition.findUnique({
      where: { id: form.id },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
  });
}

export async function submitForm(instituteId, formId, { submittedById, values, metadata }) {
  const form = await prisma.formDefinition.findFirst({
    where: { id: formId, instituteId, isPublished: true, deletedAt: null },
    include: { fields: true },
  });
  if (!form) throw new AppError('Form not found or not published', 404);

  for (const field of form.fields) {
    if (field.required && !values[field.fieldKey]) {
      throw new AppError(`Required field missing: ${field.label}`, 400);
    }
  }

  const submission = await prisma.$transaction(async (tx) => {
    const sub = await tx.formSubmission.create({
      data: { instituteId, formId, submittedById, metadata },
    });
    for (const field of form.fields) {
      const raw = values[field.fieldKey];
      if (raw === undefined || raw === null) continue;
      await tx.formFieldValue.create({
        data: {
          submissionId: sub.id,
          fieldId: field.id,
          valueText: typeof raw === 'string' ? raw : null,
          valueJson: typeof raw !== 'string' ? raw : null,
        },
      });
    }
    return sub;
  });

  await publishEvent({
    eventType: DOMAIN_EVENTS.FORM_SUBMITTED,
    aggregateType: 'FormSubmission',
    aggregateId: submission.id,
    instituteId,
    payload: { formId, purpose: form.purpose, submittedById },
  });

  return submission;
}

export async function getFormBySlug(instituteId, slug) {
  return prisma.formDefinition.findFirst({
    where: { instituteId, slug, isPublished: true, deletedAt: null },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { version: 'desc' },
  });
}

/** A/B test variant assignment — deterministic by user/session hash */
export async function resolveAbVariant(featureKey, instituteId, subjectKey) {
  const experiment = await prisma.abTestExperiment.findFirst({
    where: {
      featureKey,
      status: 'RUNNING',
      OR: [{ instituteId }, { instituteId: null }],
    },
    include: { variants: true },
  });
  if (!experiment?.variants.length) return null;

  const hash = [...featureKey, instituteId, subjectKey].join(':').length;
  const totalWeight = experiment.variants.reduce((s, v) => s + v.weight, 0);
  let pick = hash % totalWeight;
  for (const variant of experiment.variants) {
    pick -= variant.weight;
    if (pick < 0) {
      await prisma.abTestVariant.update({
        where: { id: variant.id },
        data: { impressions: { increment: 1 } },
      });
      return variant;
    }
  }
  return experiment.variants[0];
}
