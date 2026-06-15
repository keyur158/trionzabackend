import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const country = req.query.country as string | undefined;
  const where: Record<string, unknown> = { isActive: true };
  if (country) {
    where.OR = [
      { countryCodes: { isEmpty: true } },
      { countryCodes: { has: country } },
    ];
  }
  const rates = await prisma.shippingRate.findMany({ where, orderBy: { price: 'asc' } });
  res.json({ rates });
});

export default router;
