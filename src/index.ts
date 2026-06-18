import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

const app = express();

// Webhooks need the raw body for HMAC verification
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(helmet());
app.use(cors());
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

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
  res.status(err?.status || 500).json({ message: err?.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
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
  setInterval(runSync, intervalMs);
});
