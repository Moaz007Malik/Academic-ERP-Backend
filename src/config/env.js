import dotenv from 'dotenv';

dotenv.config();

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`Warning: ${key} is not set`);
  }
}

function parseList(value, fallback = []) {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

const frontendUrls = parseList(
  process.env.FRONTEND_URLS || process.env.FRONTEND_URL,
  ['http://localhost:5173'],
);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  apiVersion: process.env.API_VERSION || 'v1',
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  redisEnabled: parseBool(process.env.REDIS_ENABLED, false),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  /** @deprecated use frontendUrls */
  frontendUrl: frontendUrls[0],
  frontendUrls,
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || 'admin@erp.local',
    password: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@123',
  },
};
