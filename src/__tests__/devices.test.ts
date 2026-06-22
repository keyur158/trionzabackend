jest.mock('../config/database', () => ({
  prisma: { deviceToken: { upsert: jest.fn() } },
}));
jest.mock('../utils/jwt', () => ({ verifyToken: jest.fn() }));

import express from 'express';
import request from 'supertest';
import devicesRouter from '../routes/devices';
import { prisma } from '../config/database';
import { verifyToken } from '../utils/jwt';

const mockUpsert = prisma.deviceToken.upsert as jest.Mock;
const mockVerify = verifyToken as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/devices', devicesRouter);
  return app;
}
const app = buildApp();

describe('POST /api/devices/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers a guest token with null customerEmail (no auth header)', async () => {
    const res = await request(app)
      .post('/api/devices/register')
      .send({ fcmToken: 'tok', deviceType: 'android' });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fcmToken: 'tok' },
        create: expect.objectContaining({ customerEmail: null, fcmToken: 'tok' }),
      }),
    );
  });

  it('links the token to the customer when authenticated', async () => {
    mockVerify.mockReturnValue({ id: '1', email: 'user@x.com' });
    const res = await request(app)
      .post('/api/devices/register')
      .set('Authorization', 'Bearer validtoken')
      .send({ fcmToken: 'tok2' });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ customerEmail: 'user@x.com' }),
      }),
    );
  });

  it('treats an invalid token as a guest (does not 401)', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const res = await request(app)
      .post('/api/devices/register')
      .set('Authorization', 'Bearer garbage')
      .send({ fcmToken: 'tok3' });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ customerEmail: null }),
      }),
    );
  });

  it('400 when fcmToken missing', async () => {
    const res = await request(app).post('/api/devices/register').send({});
    expect(res.status).toBe(400);
  });
});