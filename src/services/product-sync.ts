import { prisma } from '../config/database';

interface ShopifyVariantWebhook {
  id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  sku: string | null;
  inventory_quantity: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

interface ShopifyProductWebhook {
  id: number;
  title: string;
  handle: string;
  body_html?: string | null;
  vendor?: string;
  product_type?: string;
  tags: string;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  variants: ShopifyVariantWebhook[];
  images: Array<{ id: number; src: string }>;
  metafields?: Record<string, string | string[]>;
}

export async function upsertProduct(payload: ShopifyProductWebhook): Promise<void> {
  const productId = payload.id.toString();
  const images = payload.images.map(img => ({ id: img.id, src: img.src }));
  const prices = payload.variants.map(v => parseFloat(v.price)).filter(p => !isNaN(p));
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const comparePrices = payload.variants
    .filter(v => v.compare_at_price)
    .map(v => parseFloat(v.compare_at_price!));
  // Minimum compare-at to pair with minPrice — cards show the cheapest variant
  const compareAtPrice = comparePrices.length > 0 ? Math.min(...comparePrices) : null;
  const tags = payload.tags ? payload.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const description = payload.body_html?.replace(/<[^>]+>/g, '').trim() ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.product.upsert({
      where: { id: productId },
      create: {
        id: productId,
        title: payload.title,
        handle: payload.handle,
        description,
        descriptionHtml: payload.body_html ?? null,
        vendor: payload.vendor ?? null,
        productType: payload.product_type ?? null,
        tags,
        availableForSale: payload.published_at !== null && payload.published_at !== undefined,
        minPrice: minPrice !== null ? minPrice : undefined,
        maxPrice: maxPrice !== null ? maxPrice : undefined,
        compareAtPrice: compareAtPrice !== null ? compareAtPrice : undefined,
        images,
        metafields: payload.metafields ?? {},
        shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
        shopifyUpdatedAt: payload.updated_at ? new Date(payload.updated_at) : null,
      },
      update: {
        title: payload.title,
        handle: payload.handle,
        description,
        descriptionHtml: payload.body_html ?? null,
        vendor: payload.vendor ?? null,
        productType: payload.product_type ?? null,
        tags,
        availableForSale: payload.published_at !== null && payload.published_at !== undefined,
        minPrice: minPrice !== null ? minPrice : undefined,
        maxPrice: maxPrice !== null ? maxPrice : undefined,
        compareAtPrice: compareAtPrice !== null ? compareAtPrice : undefined,
        images,
        ...(payload.metafields !== undefined && { metafields: payload.metafields }),
        shopifyUpdatedAt: payload.updated_at ? new Date(payload.updated_at) : null,
      },
    });

    // Upsert variants in place — delete-and-recreate fails when a variant is
    // referenced by a CartItem (FK Restrict), which dropped the whole update.
    for (const v of payload.variants) {
      const opts = [
        v.option1 ? { name: 'Option 1', value: v.option1 } : null,
        v.option2 ? { name: 'Option 2', value: v.option2 } : null,
        v.option3 ? { name: 'Option 3', value: v.option3 } : null,
      ].filter(Boolean);
      const data = {
        title: v.title,
        price: parseFloat(v.price),
        compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        currencyCode: 'USD',
        availableForSale: v.available,
        sku: v.sku ?? null,
        inventoryQty: v.inventory_quantity ?? 0,
        selectedOptions: opts,
        imageUrl: null,
      };
      await tx.productVariant.upsert({
        where: { id: v.id.toString() },
        create: { id: v.id.toString(), productId, ...data },
        update: data,
      });
    }
  });

  // Remove variants no longer present in the payload. Done outside the
  // transaction: a FK-violating delete would abort the whole transaction in
  // Postgres. If a variant sits in someone's cart (FK Restrict), keep the row
  // but mark it unavailable instead of failing the update.
  const incomingIds = payload.variants.map(v => v.id.toString());
  const staleVariants = await prisma.productVariant.findMany({
    where: { productId, id: { notIn: incomingIds } },
    select: { id: true },
  });
  for (const { id } of staleVariants) {
    try {
      await prisma.productVariant.delete({ where: { id } });
    } catch {
      await prisma.productVariant.update({ where: { id }, data: { availableForSale: false } });
    }
  }
}

export async function deleteProduct(id: string): Promise<void> {
  try {
    await prisma.product.delete({ where: { id } });
  } catch (err: any) {
    // Already gone locally — nothing to do.
    if (err?.code === 'P2025') return;
    // A variant is in someone's cart (FK Restrict), so the delete is blocked.
    // Mark the product and its variants unavailable so it can't be purchased.
    await prisma.$transaction([
      prisma.product.update({ where: { id }, data: { availableForSale: false } }),
      prisma.productVariant.updateMany({ where: { productId: id }, data: { availableForSale: false } }),
    ]);
  }
}
