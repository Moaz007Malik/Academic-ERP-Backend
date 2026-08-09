import { Router } from 'express';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { uploadLimiter } from '../../../middleware/rateLimiter.js';
import { documentUpload } from '../../../middleware/upload.js';
import { uploadBuffer, deleteCloudinaryAsset, isCloudinaryConfigured } from '../../../config/cloudinary.js';
import { AppError } from '../../../utils/AppError.js';
import { success } from '../../../utils/response.js';

const router = Router();
router.use(blockExpiredModuleAccess);

// Generic image upload used across features (student photo, course library covers, etc.)
// Returns the hosted URL + Cloudinary public id — callers persist those onto their own model.
router.post('/image', uploadLimiter, documentUpload.single('image'), async (req, res, next) => {
  try {
    if (!isCloudinaryConfigured()) {
      throw new AppError('File upload is not configured. Set Cloudinary credentials in server environment.', 503);
    }
    if (!req.file) throw new AppError('Image file is required', 400);
    if (!req.file.mimetype.startsWith('image/')) {
      throw new AppError('Only image files are allowed', 400);
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: `academic-erp/${req.user.instituteId}/images`,
      transformation: [{ width: 800, height: 800, crop: 'limit' }],
    });

    return success(res, { url: result.secure_url, publicId: result.public_id }, 'Image uploaded', 201);
  } catch (err) { next(err); }
});

// Cloudinary public ids contain folder slashes (e.g. "academic-erp/{instituteId}/images/xyz"),
// so the id is matched as a wildcard tail rather than a single :param segment.
router.delete('/image/*', async (req, res, next) => {
  try {
    const publicId = req.params[0];
    if (!publicId?.startsWith(`academic-erp/${req.user.instituteId}/`)) {
      throw new AppError('Not authorized to delete this asset', 403);
    }
    await deleteCloudinaryAsset(publicId);
    return success(res, null, 'Image deleted');
  } catch (err) { next(err); }
});

export default router;
