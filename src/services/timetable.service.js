import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

function scopeWhere(track, { subjectId, sectionId, degreeCourseId, individualCourseId }) {
  if (track === 'DEGREE') return { track, degreeCourseId };
  if (track === 'INDIVIDUAL_COURSE') return { track, individualCourseId };
  return { track: 'ACADEMIC', subjectId, sectionId };
}

function validateTrackColumns({ track, subjectId, sectionId, degreeCourseId, individualCourseId }) {
  if (track === 'ACADEMIC') {
    if (!subjectId) throw new AppError('subjectId is required for an academic timetable slot', 400);
    if (degreeCourseId || individualCourseId) throw new AppError('Invalid columns for ACADEMIC track', 400);
  } else if (track === 'DEGREE') {
    if (!degreeCourseId) throw new AppError('degreeCourseId is required for a degree timetable slot', 400);
    if (subjectId || sectionId || individualCourseId) throw new AppError('Invalid columns for DEGREE track', 400);
  } else if (track === 'INDIVIDUAL_COURSE') {
    if (!individualCourseId) throw new AppError('individualCourseId is required for an individual-course timetable slot', 400);
    if (subjectId || sectionId || degreeCourseId) throw new AppError('Invalid columns for INDIVIDUAL_COURSE track', 400);
  } else {
    throw new AppError('Invalid track', 400);
  }
}

/** Two kinds of conflicts on the same dayOfWeek with an overlapping time range:
 * (1) the same teacher already has another slot booked anywhere (any track);
 * (2) the same section/degree-course/individual-course already has another slot booked. */
async function findConflicts({ instituteId, track, dayOfWeek, startTime, endTime, teacherId, excludeId, ...scope }) {
  const dayFilter = { instituteId, dayOfWeek, ...(excludeId && { id: { not: excludeId } }) };

  const [teacherSlots, scopeSlots] = await Promise.all([
    teacherId
      ? prisma.timetable.findMany({ where: { ...dayFilter, teacherId }, include: { teacher: true, subject: true, section: true, degreeCourse: true, individualCourse: true } })
      : [],
    prisma.timetable.findMany({ where: { ...dayFilter, ...scopeWhere(track, scope) }, include: { teacher: true } }),
  ]);

  const conflicts = [];
  for (const slot of [...teacherSlots, ...scopeSlots]) {
    if (rangesOverlap(startTime, endTime, slot.startTime, slot.endTime)) conflicts.push(slot);
  }
  return conflicts;
}

export async function createSlot({ instituteId, track = 'ACADEMIC', dayOfWeek, startTime, endTime, room, teacherId, subjectId, sectionId, degreeCourseId, individualCourseId }) {
  if (dayOfWeek == null || !startTime || !endTime) throw new AppError('dayOfWeek, startTime and endTime are required', 400);
  if (toMinutes(startTime) >= toMinutes(endTime)) throw new AppError('startTime must be before endTime', 400);
  validateTrackColumns({ track, subjectId, sectionId, degreeCourseId, individualCourseId });

  const conflicts = await findConflicts({ instituteId, track, dayOfWeek, startTime, endTime, teacherId, subjectId, sectionId, degreeCourseId, individualCourseId });
  if (conflicts.length) {
    const conflict = conflicts[0];
    const who = conflict.teacher ? `${conflict.teacher.firstName} ${conflict.teacher.lastName}` : 'this class/course';
    throw new AppError(`Schedule conflict: ${who} is already booked ${conflict.startTime}-${conflict.endTime} on this day`, 409);
  }

  return prisma.timetable.create({
    data: {
      instituteId, track, dayOfWeek, startTime, endTime, room: room || null, teacherId: teacherId || null,
      ...(track === 'ACADEMIC' && { subjectId, sectionId: sectionId || null }),
      ...(track === 'DEGREE' && { degreeCourseId }),
      ...(track === 'INDIVIDUAL_COURSE' && { individualCourseId }),
    },
    include: { subject: true, section: { include: { batch: true } }, teacher: true, degreeCourse: true, individualCourse: true },
  });
}

export async function updateSlot({ instituteId, id, dayOfWeek, startTime, endTime, room, teacherId }) {
  const existing = await prisma.timetable.findFirst({ where: { id, instituteId } });
  if (!existing) throw new AppError('Timetable slot not found', 404);

  const nextDay = dayOfWeek ?? existing.dayOfWeek;
  const nextStart = startTime || existing.startTime;
  const nextEnd = endTime || existing.endTime;
  if (toMinutes(nextStart) >= toMinutes(nextEnd)) throw new AppError('startTime must be before endTime', 400);

  const conflicts = await findConflicts({
    instituteId, track: existing.track, dayOfWeek: nextDay, startTime: nextStart, endTime: nextEnd,
    teacherId: teacherId !== undefined ? teacherId : existing.teacherId,
    excludeId: existing.id,
    subjectId: existing.subjectId, sectionId: existing.sectionId,
    degreeCourseId: existing.degreeCourseId, individualCourseId: existing.individualCourseId,
  });
  if (conflicts.length) {
    const conflict = conflicts[0];
    const who = conflict.teacher ? `${conflict.teacher.firstName} ${conflict.teacher.lastName}` : 'this class/course';
    throw new AppError(`Schedule conflict: ${who} is already booked ${conflict.startTime}-${conflict.endTime} on this day`, 409);
  }

  return prisma.timetable.update({
    where: { id: existing.id },
    data: {
      ...(dayOfWeek !== undefined && { dayOfWeek }),
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
      ...(room !== undefined && { room: room || null }),
      ...(teacherId !== undefined && { teacherId: teacherId || null }),
    },
    include: { subject: true, section: { include: { batch: true } }, teacher: true, degreeCourse: true, individualCourse: true },
  });
}

export async function removeSlot({ instituteId, id }) {
  const existing = await prisma.timetable.findFirst({ where: { id, instituteId } });
  if (!existing) throw new AppError('Timetable slot not found', 404);
  await prisma.timetable.delete({ where: { id: existing.id } });
  return existing;
}

export async function getTimetable({ instituteId, track, sectionId, degreeCourseId, individualCourseId, teacherId }) {
  const where = { instituteId };
  if (track) where.track = track;
  if (sectionId) where.sectionId = sectionId;
  if (degreeCourseId) where.degreeCourseId = degreeCourseId;
  if (individualCourseId) where.individualCourseId = individualCourseId;
  if (teacherId) where.teacherId = teacherId;

  return prisma.timetable.findMany({
    where,
    include: { subject: true, section: { include: { batch: true } }, teacher: true, degreeCourse: true, individualCourse: true },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
}
