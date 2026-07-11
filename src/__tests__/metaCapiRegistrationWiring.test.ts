jest.mock('../services/shopify-customer', () => ({
  createShopifyCustomer: jest.fn().mockResolvedValue(null),
  updateShopifyCustomer: jest.fn(),
  getShopifyCustomerByEmail: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/email', () => ({ sendOtpEmail: jest.fn() }));
jest.mock('../services/meta-capi', () => ({
  sendCompleteRegistrationEvent: jest.fn().mockResolvedValue(true),
  extractRequestContext: jest.fn().mockReturnValue({ platform: 'android', attEnabled: false }),
}));
jest.mock('../config/database', () => ({
  prisma: {
    customer: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    otpCode: { findFirst: jest.fn(), update: jest.fn() },
  },
}));

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import router from '../routes/auth';
import { prisma } from '../config/database';
import { sendCompleteRegistrationEvent } from '../services/meta-capi';

const app = express();
app.use(express.json());
app.use('/api/auth', router);

function otpRow(purpose: 'signup' | 'login') {
  return {
    id: 1,
    email: 'new@user.com',
    codeHash: crypto.createHash('sha256').update('123456').digest('hex'),
    purpose,
    firstName: 'New',
    lastName: 'User',
    phone: '555',
    attempts: 0,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };
}

describe('POST /api/auth/verify-otp signup fires Meta CompleteRegistration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the event for a brand-new signup', async () => {
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpRow('signup'));
    (prisma.otpCode.update as jest.Mock).mockResolvedValue({});
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.customer.create as jest.Mock).mockResolvedValue({
      id: 'cust-new', email: 'new@user.com', firstName: 'New', lastName: 'User', phone: '555',
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'new@user.com', code: '123456' });

    expect(res.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(sendCompleteRegistrationEvent).toHaveBeenCalledTimes(1);
    expect((sendCompleteRegistrationEvent as jest.Mock).mock.calls[0][0].customer)
      .toMatchObject({ id: 'cust-new', email: 'new@user.com' });
  });

  it('does NOT send the event for a returning login', async () => {
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(otpRow('login'));
    (prisma.otpCode.update as jest.Mock).mockResolvedValue({});
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
      id: 'cust-old', email: 'new@user.com', firstName: 'Old', lastName: 'User',
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'new@user.com', code: '123456' });

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(sendCompleteRegistrationEvent).not.toHaveBeenCalled();
  });
});
