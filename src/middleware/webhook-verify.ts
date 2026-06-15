import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';

export function verifyShopifyWebhook(req: Request, res: Response, next: NextFunction): void {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  if (!hmac) {
    res.status(401).send('Missing HMAC');
    return;
  }
  const body = req.body as Buffer;
  const digest = crypto
    .createHmac('sha256', env.SHOPIFY_WEBHOOK_SECRET)
    .update(body)
    .digest('base64');
  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))) {
    res.status(401).send('Invalid HMAC');
    return;
  }
  next();
}