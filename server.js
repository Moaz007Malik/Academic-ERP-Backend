import app from './src/app.js';
import { env } from './src/config/env.js';
import { connectRedis } from './src/config/redis.js';
import { initJobQueue } from './src/jobs/jobQueue.js';
import { prisma } from './src/config/database.js';
import { execSync } from 'node:child_process';

async function runMigrations() {
  if (process.env.SKIP_MIGRATIONS === 'true') return;
  try {
    console.log('Running database migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('Migrations complete');
  } catch (err) {
    console.error('Migration deploy failed:', err.message);
    if (env.nodeEnv === 'production') {
      throw err;
    }
  }
}

async function bootstrap() {
  try {
    await runMigrations();
    await connectRedis();
    await initJobQueue();
    await prisma.$connect();
    console.log('Database connected');

    app.listen(env.port, () => {
      console.log(`Server running on port ${env.port} [${env.nodeEnv}]`);
      console.log(`API: http://localhost:${env.port}/api/${env.apiVersion}`);
      console.log(`Health: http://localhost:${env.port}/health`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
