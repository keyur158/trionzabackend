import { prisma } from '../config/database';
import { ValidatedDiscount, DiscountScope } from './shopify-discount';

export interface CartLine {
  productId: string;
  price: number;
  quantity: number;
}

export class DiscountNotApplicableError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DiscountNotApplicableError';
  }
}

const lineTotal = (l: CartLine) => l.price * l.quantity;

async function eligibleSubtotal(scope: DiscountScope, lines: CartLine[]): Promise<number> {
  if (scope.kind === 'all') {
    return lines.reduce((s, l) => s + lineTotal(l), 0);
  }
  if (scope.kind === 'products') {
    const ids = new Set(scope.ids);
    return lines.filter(l => ids.has(l.productId)).reduce((s, l) => s + lineTotal(l), 0);
  }
  // collections — resolve membership via the local join table
  const cartProductIds = lines.map(l => l.productId);
  if (cartProductIds.length === 0) return 0;
  const rows = await prisma.collectionProduct.findMany({
    where: { collectionId: { in: scope.ids }, productId: { in: cartProductIds } },
    select: { productId: true },
  });
  const eligible = new Set(rows.map(r => r.productId));
  return lines.filter(l => eligible.has(l.productId)).reduce((s, l) => s + lineTotal(l), 0);
}

/**
 * Returns the monetary discount to apply, based on the eligible portion of the
 * cart. Throws DiscountNotApplicableError (400) when a scoped code matches no
 * item in the cart.
 */
export async function computeDiscountAmount(discount: ValidatedDiscount, lines: CartLine[]): Promise<number> {
  const subtotal = await eligibleSubtotal(discount.scope, lines);
  if (discount.scope.kind !== 'all' && subtotal === 0) {
    throw new DiscountNotApplicableError("This code applies to select items that aren't in your cart.");
  }
  const raw = discount.discountType === 'percentage'
    ? (subtotal * discount.discountValue) / 100
    : Math.min(discount.discountValue, subtotal);
  return Math.round(raw * 100) / 100;
}
