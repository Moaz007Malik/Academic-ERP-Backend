import app from './src/app.js';
import { env } from './src/config/env.js';
import { connectRedis } from './src/config/redis.js';
import { initJobQueue } from './src/jobs/jobQueue.js';
import { prisma } from './src/config/database.js';

async function bootstrap() {
  try {
    await connectRedis();
    await initJobQueue();
    await prisma.$connect();
    console.log('Database connected');

    app.listen(env.port, () => {
      console.log(`Server running on port ${env.port} [${env.nodeEnv}]`);
      console.log(`API: http://localhost:${env.port}/api/${env.apiVersion}`);
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
