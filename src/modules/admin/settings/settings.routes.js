import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';
import { documentUpload } from '../../../middleware/upload.js';
import { uploadBuffer, isCloudinaryConfigured } from '../../../config/cloudinary.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.PROFILE_SETTINGS));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const institute = await prisma.institute.findUnique({
      where: { id: req.user.instituteId },
      include: { plan: true },
    });
    if (!institute) throw new AppError('Institute not found', 404);
    return success(res, institute);
  } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, logo, address, phone, email, settings } = req.body;
    const institute = await prisma.institute.update({
      where: { id: instituteId },
      data: {
        ...(name !== undefined && { name }),
        ...(logo !== undefined && { logo }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(settings !== undefined && { settings }),
      },
      include: { plan: true },
    });
    return success(res, institute, 'Profile updated');
  } catch (err) { next(err); }
});

router.post('/logo', documentUpload.single('logo'), async (req, res, next) => {
  try {
    if (!isCloudinaryConfigured()) {
      throw new AppError('File upload is not configured. Set Cloudinary credentials in server environment.', 503);
    }
    if (!req.file) throw new AppError('Logo image is required', 400);
    if (!req.file.mimetype.startsWith('image/')) {
      throw new AppError('Only image files are allowed for the logo', 400);
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: 'academic-erp/logos',
      transformation: [{ width: 512, height: 512, crop: 'limit' }],
    });

    const institute = await prisma.institute.update({
      where: { id: req.user.instituteId },
      data: { logo: result.secure_url },
      include: { plan: true },
    });

    return success(res, { logo: institute.logo, institute }, 'Logo uploaded');
  } catch (err) { next(err); }
});

export default router;
