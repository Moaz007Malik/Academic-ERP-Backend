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

/** App-wide day-of-week convention is 1=Monday..7=Sunday (see frontend DAYS arrays in
 * TimetablePage.jsx / Timetable.jsx) — JS's native Date#getUTCDay() is 0=Sunday..6=Saturday.
 * Uses UTC throughout (paired with toDateOnly below) so this doesn't shift by a day depending
 * on the server's local timezone offset. */
function jsDateToAppDay(date) {
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/** Normalizes to UTC midnight of the given date's UTC calendar day. Deliberately uses the UTC
 * accessors rather than their local-time equivalents — a plain `setHours(0,0,0,0)` shifts the
 * result onto the previous day once the server's local offset is positive (e.g. a "2026-08-10"
 * input, parsed as UTC midnight, becomes local 05:00 in UTC+5, and zeroing the local hours then
 * rewinds it to 2026-08-09T19:00:00Z). */
function toDateOnly(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Assigns (or replaces) the substitute teacher for one recurring slot on one specific date.
 * Rejects a substitute who's already effectively teaching an overlapping slot that same date
 * (checking both other slots' permanent teacher and their own active substitutions). */
export async function assignSubstitute({ instituteId, timetableId, date, substituteTeacherId, reason, createdById }) {
  if (!substituteTeacherId) throw new AppError('substituteTeacherId is required', 400);
  const slot = await prisma.timetable.findFirst({ where: { id: timetableId, instituteId } });
  if (!slot) throw new AppError('Timetable slot not found', 404);

  const dateOnly = toDateOnly(date);
  if (jsDateToAppDay(dateOnly) !== slot.dayOfWeek) {
    throw new AppError('The selected date does not fall on this slot\'s day of week', 400);
  }

  const daySlots = await prisma.timetable.findMany({
    where: { instituteId, dayOfWeek: slot.dayOfWeek, id: { not: slot.id } },
    include: { teacher: true, substitutions: { where: { date: dateOnly }, include: { substituteTeacher: true } } },
  });
  for (const other of daySlots) {
    const effectiveTeacherId = other.substitutions[0]?.substituteTeacherId || other.teacherId;
    if (effectiveTeacherId === substituteTeacherId && rangesOverlap(slot.startTime, slot.endTime, other.startTime, other.endTime)) {
      const name = other.substitutions[0]?.substituteTeacher
        ? `${other.substitutions[0].substituteTeacher.firstName} ${other.substitutions[0].substituteTeacher.lastName}`
        : `${other.teacher?.firstName || ''} ${other.teacher?.lastName || ''}`.trim();
      throw new AppError(`${name || 'This teacher'} is already booked ${other.startTime}-${other.endTime} on this date`, 409);
    }
  }

  return prisma.timetableSubstitution.upsert({
    where: { timetableId_date: { timetableId: slot.id, date: dateOnly } },
    create: { instituteId, timetableId: slot.id, date: dateOnly, substituteTeacherId, reason: reason || null, createdById },
    update: { substituteTeacherId, reason: reason || null, createdById },
    include: { substituteTeacher: true },
  });
}

export async function removeSubstitute({ instituteId, timetableId, date }) {
  await prisma.timetableSubstitution.deleteMany({
    where: { instituteId, timetableId, date: toDateOnly(date) },
  });
}

/** Resolves who actually teaches a slot on a given date — the day's substitute if one is
 * assigned, otherwise the slot's permanent teacher. */
export async function getEffectiveTeacher({ instituteId, timetableId, date }) {
  const slot = await prisma.timetable.findFirst({ where: { id: timetableId, instituteId }, include: { teacher: true } });
  if (!slot) return null;
  const sub = await prisma.timetableSubstitution.findUnique({
    where: { timetableId_date: { timetableId, date: toDateOnly(date) } },
    include: { substituteTeacher: true },
  });
  if (sub) return { teacherId: sub.substituteTeacherId, teacher: sub.substituteTeacher, isSubstitute: true, reason: sub.reason };
  return { teacherId: slot.teacherId, teacher: slot.teacher, isSubstitute: false };
}

/** A single calendar date's schedule (used for "today's schedule" dashboard widgets), each slot
 * annotated with its effective teacher for that date. When `teacherId` is passed, matches slots
 * where that teacher is the effective teacher — including ones they're only substituting for
 * that day, which a plain `where: { teacherId }` filter would miss. */
export async function getScheduleForDate({ instituteId, date, teacherId, sectionId, degreeCourseId, individualCourseId }) {
  const dateOnly = toDateOnly(date);
  const appDay = jsDateToAppDay(dateOnly);

  const slots = await prisma.timetable.findMany({
    where: {
      instituteId,
      dayOfWeek: appDay,
      ...(sectionId && { sectionId }),
      ...(degreeCourseId && { degreeCourseId }),
      ...(individualCourseId && { individualCourseId }),
    },
    include: {
      subject: true,
      section: { include: { batch: true } },
      teacher: true,
      degreeCourse: { include: { semester: true } },
      individualCourse: true,
      substitutions: { where: { date: dateOnly }, include: { substituteTeacher: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  const withEffectiveTeacher = slots.map((s) => {
    const sub = s.substitutions[0];
    return {
      ...s,
      effectiveTeacher: sub ? sub.substituteTeacher : s.teacher,
      isSubstitute: !!sub,
      substituteReason: sub?.reason || null,
    };
  });

  return teacherId
    ? withEffectiveTeacher.filter((s) => s.effectiveTeacher?.id === teacherId)
    : withEffectiveTeacher;
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
