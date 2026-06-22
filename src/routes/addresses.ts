import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const addresses = await prisma.address.findMany({
    where: { customerId: req.user!.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ addresses });
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const { firstName, lastName, address1, address2, city, province, country, zip, phone } = req.body;
  if (!address1 || !city || !country || !zip || !phone) {
    res.status(400).json({ message: 'address1, city, country, zip, and phone are required' });
    return;
  }
  const existingCount = await prisma.address.count({ where: { customerId: req.user!.id } });
  const isDefault = existingCount === 0;
  const address = await prisma.address.create({
    data: { customerId: req.user!.id, firstName, lastName, address1, address2, city, province, country, zip, phone, isDefault },
  });
  res.status(201).json({ address });
});

router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const existing = await prisma.address.findFirst({ where: { id, customerId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ message: 'Address not found' });
    return;
  }
  const { firstName, lastName, address1, address2, city, province, country, zip, phone } = req.body;
  const address = await prisma.address.update({
    where: { id },
    data: { firstName, lastName, address1, address2, city, province, country, zip, phone },
  });
  res.json({ address });
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const existing = await prisma.address.findFirst({ where: { id, customerId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ message: 'Address not found' });
    return;
  }
  await prisma.address.delete({ where: { id } });
  res.json({ success: true });
});

router.post('/:id/set-default', requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const existing = await prisma.address.findFirst({ where: { id, customerId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ message: 'Address not found' });
    return;
  }
  await prisma.$transaction([
    prisma.address.updateMany({ where: { customerId: req.user!.id }, data: { isDefault: false } }),
    prisma.address.update({ where: { id }, data: { isDefault: true } }),
  ]);
  res.json({ success: true });
});

export default router;
