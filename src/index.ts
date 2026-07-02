
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { prisma } from './config/database';
import { env } from './config/env';
import { syncAll } from './services/shopify-sync';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import collectionRoutes from './routes/collections';
import cartRoutes from './routes/cart';
import checkoutRoutes from './routes/checkout';
import orderRoutes from './routes/orders';
import addressRoutes from './routes/addresses';
import deviceRoutes from './routes/devices';
import shippingRoutes from './routes/shipping';
import webhookRoutes from './routes/webhooks';
import inquiryRoutes from './routes/inquiries';
import reviewRoutes from './routes/reviews';
import appVersionRoutes from './routes/appVersion';
import adminAppVersionRoutes from './routes/adminAppVersions';
import adminNotificationRoutes from './routes/adminNotifications';
import adminStatsRoutes from './routes/adminStats';
import adminReviewRoutes from './routes/adminReviews';

const app = express();

// Behind Nginx — trust the first proxy hop so req.ip is the real client IP.
app.set('trust proxy', 1);

// Webhooks need the raw body for HMAC verification
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(helmet());
app.use(cors());
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

// Rate limits — generous enough that legitimate users never hit them.
// Scoped to /api so Shopify webhook bursts are never throttled.
const limiterDefaults = { standardHeaders: true as const, legacyHeaders: false };
const globalLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 600 });
const requestOtpLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 10 });
const verifyOtpLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 30 });
const inquiryLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 60 * 1000, limit: 5 });

app.use('/api', globalLimiter);
app.use('/api/auth/request-otp', requestOtpLimiter);
app.use('/api/auth/verify-otp', verifyOtpLimiter);
app.use('/api/inquiries', inquiryLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/shipping-rates', shippingRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/products', reviewRoutes);
app.use('/api/app', appVersionRoutes);
app.use('/api/admin/app-versions', adminAppVersionRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/admin/stats', adminStatsRoutes);
app.use('/api/admin/reviews', adminReviewRoutes);
app.use('/webhooks', webhookRoutes);

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[uncaught]', err?.message || err);
  const message = process.env.NODE_ENV !== 'production'
    ? (err?.message || 'Internal server error')
    : 'Internal server error';
  res.status(err?.status || 500).json({ message });
});

const PORT = process.env.PORT || 3000;
let syncTimer: NodeJS.Timeout | undefined;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Run an initial sync on startup, then repeat on the configured interval.
  const intervalMs = env.SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
  const runSync = () => {
    console.log('[sync] Starting scheduled product sync...');
    syncAll()
      .then(() => console.log('[sync] Scheduled sync complete'))
      .catch(err => console.error('[sync] Scheduled sync failed:', err));
  };

  runSync();
  syncTimer = setInterval(runSync, intervalMs);
});

function shutdown(signal: string): void {
  console.log(`${signal} received — shutting down gracefully...`);
  if (syncTimer) clearInterval(syncTimer);
  // Hard-exit fallback in case close() hangs on open connections.
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10000);
  forceExit.unref();
  server.close(() => {
    prisma.$disconnect()
      .catch(err => console.error('Error disconnecting Prisma:', err))
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
