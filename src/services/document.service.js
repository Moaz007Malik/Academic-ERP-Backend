import { prisma } from '../config/database.js';
import { isCloudinaryConfigured, uploadBuffer, deleteCloudinaryAsset } from '../config/cloudinary.js';
import { AppError } from '../utils/AppError.js';

export function assertCloudinaryReady() {
  if (!isCloudinaryConfigured()) {
    throw new AppError('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env', 503);
  }
}

export async function uploadPersonDocument({
  file,
  instituteId,
  personType,
  studentId,
  teacherId,
  category,
  title,
  uploadedById,
}) {
  assertCloudinaryReady();

  const folder = `academic-erp/${instituteId}/${personType.toLowerCase()}`;
  const result = await uploadBuffer(file.buffer, {
    folder,
    public_id: `${Date.now()}-${file.originalname.replace(/\.[^.]+$/, '').slice(0, 40)}`,
  });

  const doc = await prisma.personDocument.create({
    data: {
      instituteId,
      personType,
      studentId: studentId || null,
      teacherId: teacherId || null,
      category: category || 'OTHER',
      title: title || file.originalname,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      cloudinaryId: result.public_id,
      url: result.secure_url,
      uploadedById: uploadedById || null,
    },
  });

  return doc;
}

export async function deletePersonDocument(doc, instituteId) {
  if (doc.instituteId !== instituteId) {
    throw new AppError('Document not found', 404);
  }
  try {
    await deleteCloudinaryAsset(doc.cloudinaryId);
  } catch {
    // continue DB delete if Cloudinary asset already removed
  }
  await prisma.personDocument.delete({ where: { id: doc.id } });
}

export async function listPersonDocuments({ instituteId, studentId, teacherId }) {
  const where = { instituteId };
  if (studentId) where.studentId = studentId;
  if (teacherId) where.teacherId = teacherId;

  return prisma.personDocument.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      uploadedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}
