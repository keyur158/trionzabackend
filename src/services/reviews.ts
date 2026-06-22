import { prisma } from '../config/database';

export class ReviewError extends Error {
  constructor(public code: 'NOT_FOUND' | 'DUPLICATE', message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}

export interface ReviewInput {
  rating: number;
  title?: string;
  body: string;
}

type OrderLineItems = { lineItems: unknown };

/** True when any order line item references the product. Line items store
 *  `productId` (see checkout.ts). Pure — unit tested without a database. */
export function isVerifiedBuyer(orders: OrderLineItems[], productId: string): boolean {
  for (const order of orders) {
    const items = Array.isArray(order.lineItems) ? order.lineItems : [];
    for (const li of items as Array<Record<string, unknown>>) {
      if (li && li.productId === productId) return true;
    }
  }
  return false;
}

async function productByHandle(handle: string) {
  const product = await prisma.product.findUnique({
    where: { handle },
    select: { id: true },
  });
  if (!product) throw new ReviewError('NOT_FOUND', 'Product not found');
  return product;
}

async function recomputeAggregate(productId: string): Promise<void> {
  const [agg, count] = await Promise.all([
    prisma.review.aggregate({
      where: { productId, status: 'published' },
      _avg: { rating: true },
    }),
    prisma.review.count({ where: { productId, status: 'published' } }),
  ]);
  await prisma.product.update({
    where: { id: productId },
    data: {
      avgRating: agg._avg.rating ?? null,
      reviewCount: count,
    },
  });
}

export async function getProductReviews(handle: string, page: number, limit: number) {
  const product = await productByHandle(handle);
  const [reviews, count, dist] = await Promise.all([
    prisma.review.findMany({
      where: { productId: product.id, status: 'published' },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit + 1,
      select: {
        id: true, rating: true, title: true, body: true,
        authorName: true, isVerified: true, createdAt: true,
      },
    }),
    prisma.review.count({ where: { productId: product.id, status: 'published' } }),
    prisma.review.groupBy({
      by: ['rating'],
      where: { productId: product.id, status: 'published' },
      _count: { rating: true },
    }),
  ]);
  const hasMore = reviews.length > limit;
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const d of dist) {
    distribution[d.rating] = d._count.rating;
    sum += d.rating * d._count.rating;
  }
  return {
    summary: { average: count ? sum / count : 0, count, distribution },
    reviews: hasMore ? reviews.slice(0, limit) : reviews,
    page,
    hasMore,
  };
}

export async function createReview(handle: string, customerId: string, input: ReviewInput) {
  const product = await productByHandle(handle);
  const [customer, orders, existing] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { firstName: true, lastName: true },
    }),
    prisma.order.findMany({ where: { customerId }, select: { lineItems: true } }),
    prisma.review.findUnique({
      where: { productId_customerId: { productId: product.id, customerId } },
      select: { id: true },
    }),
  ]);
  if (existing) throw new ReviewError('DUPLICATE', 'You have already reviewed this product');

  const authorName =
    [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim() ||
    'Verified Customer';

  const review = await prisma.review.create({
    data: {
      productId: product.id,
      customerId,
      rating: input.rating,
      title: input.title?.trim() || null,
      body: input.body.trim(),
      authorName,
      isVerified: isVerifiedBuyer(orders, product.id),
    },
  });
  await recomputeAggregate(product.id);
  return review;
}

export async function getReviewEligibility(handle: string, customerId: string) {
  const product = await productByHandle(handle);
  const [existing, orders] = await Promise.all([
    prisma.review.findUnique({
      where: { productId_customerId: { productId: product.id, customerId } },
      select: { id: true },
    }),
    prisma.order.findMany({ where: { customerId }, select: { lineItems: true } }),
  ]);
  const alreadyReviewed = existing != null;
  return {
    canReview: !alreadyReviewed,
    alreadyReviewed,
    isVerifiedBuyer: isVerifiedBuyer(orders, product.id),
  };
}