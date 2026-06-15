import { Router, Request, Response } from 'express';
import NodeCache from 'node-cache';
import { prisma } from '../config/database';

const router = Router();
const cache = new NodeCache({ stdTTL: 300 }); // 5-minute cache

// Minimal product fields for collection listings — no variants
const COLLECTION_PRODUCT_SELECT = {
  product: {
    select: {
      id: true,
      title: true,
      handle: true,
      vendor: true,
      productType: true,
      tags: true,
      availableForSale: true,
      minPrice: true,
      maxPrice: true,
      compareAtPrice: true,
      currencyCode: true,
      images: true,
      metafields: true,
      shopifyCreatedAt: true,
    },
  },
};

router.get('/', async (_req: Request, res: Response) => {
  const cacheKey = 'collections:all';
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const collections = await prisma.collection.findMany({ orderBy: { title: 'asc' } });
  const result = { collections };
  cache.set(cacheKey, result);
  res.json(result);
});

router.get('/:handle', async (req: Request, res: Response) => {
  const handle = req.params.handle as string;

  const tagVirtualCollections: Record<string, { title: string; tag: string }> = {
    'all-lab-grown': { title: 'Lab Grown Diamonds', tag: 'tag__hot_Lab Grown Diamond' },
    'all-moissanite': { title: 'Moissanite', tag: 'tag__new_Moissanite' },
  };

  if (tagVirtualCollections[handle]) {
    const cacheKey = `collection:${handle}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    const { title, tag } = tagVirtualCollections[handle];
    const products = await prisma.product.findMany({
      where: { availableForSale: true, tags: { has: tag } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        handle: true,
        vendor: true,
        productType: true,
        tags: true,
        availableForSale: true,
        minPrice: true,
        maxPrice: true,
        compareAtPrice: true,
        currencyCode: true,
        images: true,
        metafields: true,
        shopifyCreatedAt: true,
      },
    });
    const result = { collection: { id: handle, title, handle, products } };
    cache.set(cacheKey, result);
    res.json(result);
    return;
  }

  const cacheKey = `collection:${handle}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const collection = await prisma.collection.findUnique({
    where: { handle },
    include: {
      products: {
        orderBy: { position: 'asc' },
        select: COLLECTION_PRODUCT_SELECT,
      },
    },
  });
  if (!collection) {
    res.status(404).json({ message: 'Collection not found' });
    return;
  }
  const result = { collection };
  cache.set(cacheKey, result);
  res.json(result);
});

export default router;
