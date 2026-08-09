import { prisma } from '../config/database.js';
import { isCloudinaryConfigured, uploadBuffer, deleteCloudinaryAsset } from '../config/cloudinary.js';
import { AppError } from '../utils/AppError.js';

export function assertCloudinaryReady() {
  if (!isCloudinaryConfigured()) {
    throw new AppError('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env', 503);
  }
}

export async function uploadCourseDocument({ file, instituteId, courseId, category, title, uploadedById }) {
  assertCloudinaryReady();

  const folder = `academic-erp/${instituteId}/courses/${courseId}`;
  const result = await uploadBuffer(file.buffer, {
    folder,
    public_id: `${Date.now()}-${file.originalname.replace(/\.[^.]+$/, '').slice(0, 40)}`,
  });

  return prisma.courseCatalogDocument.create({
    data: {
      instituteId,
      courseId,
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
}

export async function deleteCourseDocument(doc, instituteId) {
  if (doc.instituteId !== instituteId) {
    throw new AppError('Document not found', 404);
  }
  try {
    const resourceType = doc.mimeType?.startsWith('image/') ? 'image' : 'raw';
    await deleteCloudinaryAsset(doc.cloudinaryId, resourceType);
  } catch {
    // continue DB delete if Cloudinary asset already removed
  }
  await prisma.courseCatalogDocument.delete({ where: { id: doc.id } });
}

export async function listCourseDocuments({ instituteId, courseId }) {
  return prisma.courseCatalogDocument.findMany({
    where: { instituteId, courseId },
    orderBy: { createdAt: 'desc' },
    include: {
      uploadedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}
