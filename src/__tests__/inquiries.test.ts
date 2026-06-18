jest.mock('../services/email', () => ({
  sendAppointmentEmails: jest.fn().mockResolvedValue(undefined),
  sendCustomOrderEmails: jest.fn().mockResolvedValue(undefined),
}));

import express from 'express';
import request from 'supertest';
import inquiriesRouter from '../routes/inquiries';
import { sendAppointmentEmails, sendCustomOrderEmails } from '../services/email';

const mockAppointment = sendAppointmentEmails as jest.Mock;
const mockCustomOrder = sendCustomOrderEmails as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/inquiries', inquiriesRouter);
  return app;
}

const app = buildApp();

describe('POST /api/inquiries/appointment', () => {
  beforeEach(() => jest.clearAllMocks());

  const valid = {
    name: 'Jane Doe',
    phone: '1234567',
    email: 'jane@example.com',
    date: 'Jun 20, 2026',
    time: '11:00 AM',
    purpose: 'Gift Selection Help',
  };

  it('accepts a valid appointment and sends emails', async () => {
    const res = await request(app).post('/api/inquiries/appointment').send(valid);
    expect(res.status).toBe(200);
    expect(mockAppointment).toHaveBeenCalledTimes(1);
    expect(mockAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jane@example.com', name: 'Jane Doe' })
    );
  });

  it('rejects when email is missing', async () => {
    const { email, ...rest } = valid;
    const res = await request(app).post('/api/inquiries/appointment').send(rest);
    expect(res.status).toBe(400);
    expect(mockAppointment).not.toHaveBeenCalled();
  });

  it('still returns 200 even if email delivery throws', async () => {
    mockAppointment.mockRejectedValueOnce(new Error('zepto down'));
    const res = await request(app).post('/api/inquiries/appointment').send(valid);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/inquiries/custom-order', () => {
  beforeEach(() => jest.clearAllMocks());

  const valid = {
    name: 'Jane Doe',
    phone: '1234567',
    email: 'jane@example.com',
    jewelleryType: 'Ring',
    metal: 'Gold',
    budget: 2000,
  };

  it('accepts a valid custom order and sends emails', async () => {
    const res = await request(app).post('/api/inquiries/custom-order').send(valid);
    expect(res.status).toBe(200);
    expect(mockCustomOrder).toHaveBeenCalledTimes(1);
    expect(mockCustomOrder).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jane@example.com', jewelleryType: 'Ring' })
    );
  });

  it('rejects when jewelleryType is missing', async () => {
    const { jewelleryType, ...rest } = valid;
    const res = await request(app).post('/api/inquiries/custom-order').send(rest);
    expect(res.status).toBe(400);
    expect(mockCustomOrder).not.toHaveBeenCalled();
  });
});