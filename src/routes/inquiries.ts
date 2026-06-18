import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendAppointmentEmails, sendCustomOrderEmails } from '../services/email';

const router = Router();

const appointmentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().min(1, 'Phone is required'),
  email: z.string().trim().email('A valid email is required'),
  date: z.string().trim().min(1, 'Date is required'),
  time: z.string().trim().min(1, 'Time is required'),
  purpose: z.string().trim().min(1, 'Purpose is required'),
});

const customOrderSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().min(1, 'Phone is required'),
  email: z.string().trim().email('A valid email is required'),
  jewelleryType: z.string().trim().min(1, 'Jewellery type is required'),
  metal: z.string().trim().optional(),
  metalColor: z.string().trim().optional(),
  stone: z.string().trim().optional(),
  ctWeight: z.union([z.string(), z.number()]).optional(),
  diamondColor: z.string().trim().optional(),
  size: z.string().trim().optional(),
  description: z.string().trim().optional(),
  budget: z.union([z.string(), z.number()]).optional(),
  deliveryDate: z.string().trim().optional(),
  hasReferenceImage: z.boolean().optional(),
});

// POST /api/inquiries/appointment
router.post('/appointment', async (req: Request, res: Response) => {
  const parsed = appointmentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  // Log a recoverable record in case email delivery later fails.
  console.log('[inquiries] appointment request:', JSON.stringify(parsed.data));

  try {
    await sendAppointmentEmails(parsed.data);
  } catch (err) {
    console.error('[inquiries] appointment email error:', err);
    // Still acknowledge — the request data is logged above.
  }

  res.json({ message: 'Appointment request received' });
});

// POST /api/inquiries/custom-order
router.post('/custom-order', async (req: Request, res: Response) => {
  const parsed = customOrderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  console.log('[inquiries] custom order request:', JSON.stringify(parsed.data));

  try {
    await sendCustomOrderEmails(parsed.data);
  } catch (err) {
    console.error('[inquiries] custom order email error:', err);
    // Still acknowledge — the request data is logged above.
  }

  res.json({ message: 'Custom order request received' });
});

export default router;