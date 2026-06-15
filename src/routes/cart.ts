import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';

const router = Router();

const cartInclude = {
  items: {
    include: {
      product: { select: { id: true, title: true, handle: true, images: true } },
      variant: { select: { id: true, title: true, price: true, compareAtPrice: true, availableForSale: true, inventoryQty: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};
async function getOrCreateCart(customerId: string) {
  try {
    return await prisma.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: {},
      include: cartInclude,
    });
  } catch (e: any) {
    if (e.code === 'P2003') {
      const err = new Error('Session expired. Please log in again.') as any;
      err.status = 401;
      throw err;
    }
    throw e;
  }
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const cart = await getOrCreateCart(req.user!.id);
  res.json({ cart });
});

router.post('/add', requireAuth, async (req: Request, res: Response) => {
  try {
    const { variantId, quantity, properties } = req.body;
    if (!variantId || !quantity || quantity < 1) {
      res.status(400).json({ message: 'variantId and quantity (>= 1) are required' });
      return;
    }
    const variant = await prisma.productVariant.findUnique({ where: { id: String(variantId) } });
    if (!variant) {
      res.status(404).json({ message: `Variant not found: ${variantId}` });
      return;
    }
    if (!variant.availableForSale) {
      res.status(409).json({ message: 'Item is out of stock' });
      return;
    }

    const cart = await getOrCreateCart(req.user!.id);
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: String(variantId) } },
      create: { cartId: cart.id, productId: variant.productId, variantId: String(variantId), quantity, ...(properties && { properties }) },
      update: { quantity: { increment: quantity }, ...(properties && { properties }) },
    });

    const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    res.json({ cart: updatedCart });
  } catch (err: any) {
    console.error('[cart/add]', err?.message || err);
    res.status(err?.status || 500).json({ message: err?.message || 'Internal server error' });
  }
});

router.put('/update', requireAuth, async (req: Request, res: Response) => {
  const { itemId, quantity } = req.body;
  if (itemId === undefined || quantity === undefined) {
    res.status(400).json({ message: 'itemId and quantity are required' });
    return;
  }
  const cart = await getOrCreateCart(req.user!.id);
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) {
    res.status(404).json({ message: 'Cart item not found' });
    return;
  }

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: itemId } });
  } else {
    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  }

  const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
  res.json({ cart: updatedCart });
});

router.delete('/remove/:itemId', requireAuth, async (req: Request, res: Response) => {
  const itemId = parseInt(req.params.itemId as string);
  const cart = await getOrCreateCart(req.user!.id);
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
  res.json({ cart: updatedCart });
});

router.delete('/clear', requireAuth, async (req: Request, res: Response) => {
  const cart = await getOrCreateCart(req.user!.id);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
  res.json({ cart: updatedCart });
});

export default router;
