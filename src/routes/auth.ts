import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { signToken } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import {
  createShopifyCustomer,
  updateShopifyCustomer,
  getShopifyCustomerByEmail,
} from '../services/shopify-customer';
import { sendOtpEmail } from '../services/email';
import { isAdminEmail } from '../utils/admin';
import { sendCompleteRegistrationEvent, extractRequestContext } from '../services/meta-capi';

const router = Router();

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_VERIFY_ATTEMPTS = 5;

function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
}

function tokenResponse(customer: { id: string; email: string; firstName: string | null; lastName: string | null }) {
  const token = signToken({ id: customer.id, email: customer.email });
  return {
    token,
    customer: {
      id: customer.id,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      isAdmin: isAdminEmail(customer.email),
    },
  };
}

// POST /api/auth/request-otp { email, purpose: 'login' | 'signup', firstName?, lastName?, phone? }
router.post('/request-otp', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const purpose = req.body?.purpose;
  const { firstName, lastName, phone } = req.body ?? {};

  if (!email) {
    res.status(400).json({ message: 'A valid email is required' });
    return;
  }
  if (purpose !== 'login' && purpose !== 'signup') {
    res.status(400).json({ message: 'purpose must be "login" or "signup"' });
    return;
  }

  const existing = await prisma.customer.findUnique({ where: { email } });

  if (purpose === 'signup') {
    if (existing) {
      res.status(409).json({ message: 'An account with this email already exists. Please sign in.' });
      return;
    }
  } else {
    // login — allow if the customer exists locally or in Shopify
    if (!existing) {
      const shopifyCustomer = await getShopifyCustomerByEmail(email);
      if (!shopifyCustomer) {
        res.status(404).json({ message: 'No account found with this email. Please sign up.' });
        return;
      }
    }
  }

  // Enforce resend cooldown based on the most recent unconsumed code
  const recent = await prisma.otpCode.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000);
    res.status(429).json({ message: `Please wait ${waitSec}s before requesting another code` });
    return;
  }

  // Invalidate any prior unconsumed codes for this email + purpose
  await prisma.otpCode.deleteMany({ where: { email, purpose, consumedAt: null } });

  const code = generateOtp();
  await prisma.otpCode.create({
    data: {
      email,
      codeHash: hashOtp(code),
      purpose,
      firstName: purpose === 'signup' ? (firstName ?? null) : null,
      lastName: purpose === 'signup' ? (lastName ?? null) : null,
      phone: purpose === 'signup' ? (phone ?? null) : null,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  try {
    await sendOtpEmail(email, code);
  } catch {
    res.status(502).json({ message: 'Could not send verification email. Please try again.' });
    return;
  }

  res.json({ message: 'Verification code sent', email });
});

// POST /api/auth/verify-otp { email, code }
router.post('/verify-otp', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

  if (!email || !code) {
    res.status(400).json({ message: 'Email and code are required' });
    return;
  }

  const otp = await prisma.otpCode.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) {
    res.status(400).json({ message: 'No active verification code. Please request a new one.' });
    return;
  }
  if (otp.expiresAt < new Date()) {
    res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
    return;
  }
  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
    res.status(429).json({ message: 'Too many attempts. Please request a new code.' });
    return;
  }

  if (hashOtp(code) !== otp.codeHash) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    res.status(401).json({ message: 'Invalid verification code' });
    return;
  }

  // Code is valid — consume it
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  if (otp.purpose === 'signup') {
    // Guard against a race where the account was created meanwhile
    const already = await prisma.customer.findUnique({ where: { email } });
    if (already) {
      res.status(200).json(tokenResponse(already));
      return;
    }

    const customer = await prisma.customer.create({
      data: {
        email,
        firstName: otp.firstName,
        lastName: otp.lastName,
        phone: otp.phone,
      },
    });

    const metaCtx = extractRequestContext(req);
    setImmediate(async () => {
      const shopifyGid = await createShopifyCustomer({
        email,
        firstName: otp.firstName ?? undefined,
        lastName: otp.lastName ?? undefined,
        phone: otp.phone ?? undefined,
      });
      if (shopifyGid) {
        await prisma.customer.update({ where: { id: customer.id }, data: { shopifyCustomerId: shopifyGid } });
      }
      try {
        await sendCompleteRegistrationEvent({
          customer: {
            id: customer.id,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: otp.phone,
          },
          ctx: metaCtx,
        });
      } catch (err) {
        console.error('Meta CAPI CompleteRegistration failed:', err);
      }
    });

    res.status(201).json(tokenResponse(customer));
    return;
  }

  // login
  let customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer) {
    // Shopify-only customer signing in for the first time — create local record
    const shopifyCustomer = await getShopifyCustomerByEmail(email);
    if (!shopifyCustomer) {
      res.status(404).json({ message: 'No account found with this email' });
      return;
    }
    try {
      customer = await prisma.customer.create({
        data: {
          email,
          firstName: shopifyCustomer.firstName,
          lastName: shopifyCustomer.lastName,
          phone: shopifyCustomer.phone,
          shopifyCustomerId: shopifyCustomer.id,
        },
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        customer = await prisma.customer.findUnique({ where: { email } });
      }
      if (!customer) {
        res.status(500).json({ message: 'Account setup failed' });
        return;
      }
    }
  }

  res.json(tokenResponse(customer));
});

router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true },
  });
  if (!customer) {
    res.status(404).json({ message: 'Customer not found' });
    return;
  }
  res.json({ customer: { ...customer, isAdmin: isAdminEmail(customer.email) } });
});

router.put('/profile', requireAuth, async (req: Request, res: Response) => {
  const { firstName, lastName, phone } = req.body;
  const customer = await prisma.customer.update({
    where: { id: req.user!.id },
    data: { firstName, lastName, phone },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, shopifyCustomerId: true },
  });

  if (customer.shopifyCustomerId) {
    setImmediate(async () => {
      await updateShopifyCustomer(customer.shopifyCustomerId!, {
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
      });
    });
  }

  res.json({ customer });
});

export default router;
