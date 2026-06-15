import { prisma } from '../config/database';
import { shopifyGraphQL, shopifyStorefrontGraphQL } from '../config/shopify';
import { upsertProduct } from './product-sync';

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          vendor
          productType
          tags
          createdAt
          updatedAt
          publishedAt
          images(first: 10) {
            edges { node { id url } }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                availableForSale
                sku
                inventoryQuantity
                selectedOptions { name value }
                image { url }
              }
            }
          }
          metafields(first: 10, namespace: "custom") {
            edges { node { key value } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function buildMetaobjectMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const q = `query {
    growth: metaobjects(type: "growth_type", first: 50) { edges { node { id fields { key value } } } }
    shape: metaobjects(type: "shape", first: 50) { edges { node { id fields { key value } } } }
    style: metaobjects(type: "style", first: 50) { edges { node { id fields { key value } } } }
    category: metaobjects(type: "category", first: 50) { edges { node { id fields { key value } } } }
  }`;
  const result = await shopifyStorefrontGraphQL(q);
  for (const typeKey of ['growth', 'shape', 'style', 'category']) {
    for (const { node } of (result.data?.[typeKey]?.edges ?? [])) {
      const labelField = (node.fields as Array<{ key: string; value: string }>)
        .find(f => f.key === 'label');
      if (labelField?.value) map.set(node.id as string, labelField.value);
    }
  }
  return map;
}

function resolveMetafieldValue(raw: string, map: Map<string, string>): string[] | null {
  // List of metaobject references: JSON array string
  if (raw.startsWith('[')) {
    try {
      const gids = JSON.parse(raw) as string[];
      const labels = gids.map(g => map.get(g)).filter(Boolean) as string[];
      return labels.length > 0 ? labels : null;
    } catch {
      return null;
    }
  }
  // Single metaobject reference
  if (raw.startsWith('gid://shopify/Metaobject/')) {
    const label = map.get(raw);
    return label ? [label] : null;
  }
  // Plain string value
  return raw.trim() ? [raw.trim()] : null;
}

const COLLECTIONS_QUERY = `
  query GetCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          description
          image { url }
          sortOrder
          updatedAt
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `
  query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        edges { node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function extractId(gid: string): string {
  return gid.split('/').pop() ?? gid;
}

export async function syncProducts(): Promise<number> {
  let hasNextPage = true;
  let cursor: string | null = null;
  let total = 0;

  const metaobjectMap = await buildMetaobjectMap();
  console.log(`[sync] Loaded ${metaobjectMap.size} metaobject labels`);

  while (hasNextPage) {
    const data = await shopifyGraphQL(PRODUCTS_QUERY, { first: 50, after: cursor });
    const { edges, pageInfo } = data.data.products;

    for (const { node } of edges) {
      const productId = extractId(node.id as string);
      const images = (node.images.edges as Array<{ node: { id: string; url: string } }>).map(e => ({
        id: parseInt(extractId(e.node.id)),
        src: e.node.url,
      }));
      const variants = (node.variants.edges as Array<{ node: Record<string, unknown> }>).map(e => {
        const v = e.node;
        return {
          id: parseInt(extractId(v.id as string)),
          title: v.title as string,
          price: v.price as string,
          compare_at_price: v.compareAtPrice as string | null,
          available: v.availableForSale as boolean,
          sku: v.sku as string | null,
          inventory_quantity: (v.inventoryQuantity as number) ?? 0,
          option1: (v.selectedOptions as Array<{ value: string }>)[0]?.value ?? null,
          option2: (v.selectedOptions as Array<{ value: string }>)[1]?.value ?? null,
          option3: (v.selectedOptions as Array<{ value: string }>)[2]?.value ?? null,
        };
      });

      const metafields: Record<string, string[]> = {};
      const mfEdges = (node.metafields as { edges: Array<{ node: { key: string; value: string } }> } | null)?.edges ?? [];
      for (const { node: mf } of mfEdges) {
        if (!mf?.key || !mf?.value) continue;
        const resolved = resolveMetafieldValue(mf.value, metaobjectMap);
        if (resolved !== null) metafields[mf.key] = resolved;
      }

      try {
        await upsertProduct({
          id: parseInt(productId),
          title: node.title as string,
          handle: node.handle as string,
          body_html: node.descriptionHtml as string,
          vendor: node.vendor as string,
          product_type: node.productType as string,
          tags: (node.tags as string[]).join(', '),
          published_at: node.publishedAt as string | null,
          created_at: node.createdAt as string,
          updated_at: node.updatedAt as string,
          variants,
          images,
          metafields,
        });
        total++;
      } catch (err: any) {
        const msg = err?.message || err?.toString() || String(err);
        console.warn(`[sync] Skipping product ${productId} (${node.handle}): ${msg.slice(0, 200)}`);
      }
    }

    hasNextPage = pageInfo.hasNextPage as boolean;
    cursor = pageInfo.endCursor as string | null;
  }
  return total;
}

export async function syncCollections(): Promise<number> {
  let hasNextPage = true;
  let cursor: string | null = null;
  let total = 0;

  while (hasNextPage) {
    const data = await shopifyGraphQL(COLLECTIONS_QUERY, { first: 50, after: cursor });
    const { edges, pageInfo } = data.data.collections;

    for (const { node } of edges) {
      const collectionId = extractId(node.id as string);
      const collectionData = {
        title: node.title as string,
        handle: node.handle as string,
        description: node.description as string | null,
        imageUrl: (node.image as { url: string } | null)?.url ?? null,
        sortOrder: node.sortOrder as string | null,
        shopifyUpdatedAt: node.updatedAt ? new Date(node.updatedAt as string) : null,
      };
      try {
        await prisma.collection.upsert({
          where: { id: collectionId },
          create: { id: collectionId, ...collectionData },
          update: collectionData,
        });
      } catch {
        // handle already exists under a different id — update by handle
        try {
          await prisma.collection.upsert({
            where: { handle: node.handle as string },
            create: { id: collectionId, ...collectionData },
            update: { id: collectionId, ...collectionData },
          });
        } catch (inner: any) {
          console.warn(`[sync] Skipping collection ${node.handle}: ${inner?.message?.slice(0, 120)}`);
          continue;
        }
      }

      // Paginate through ALL products in this collection (no 250-item cap)
      const shopifyCollectionGid = node.id as string;
      let productHasNextPage = true;
      let productCursor: string | null = null;
      let position = 0;

      while (productHasNextPage) {
        const productData = await shopifyGraphQL(COLLECTION_PRODUCTS_QUERY, {
          id: shopifyCollectionGid,
          first: 250,
          after: productCursor,
        });
        const productConn = productData.data.collection?.products as {
          edges: Array<{ node: { id: string } }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        } | null;

        if (!productConn) break;

        const pageProductIds = productConn.edges.map(({ node: pn }) => extractId(pn.id));

        const existingProducts = await prisma.product.findMany({
          where: { id: { in: pageProductIds } },
          select: { id: true },
        });
        const existingSet = new Set(existingProducts.map(p => p.id));

        for (const productId of pageProductIds) {
          if (existingSet.has(productId)) {
            await prisma.collectionProduct.upsert({
              where: { collectionId_productId: { collectionId, productId } },
              create: { collectionId, productId, position },
              update: { position },
            });
          }
          position++;
        }

        productHasNextPage = productConn.pageInfo.hasNextPage;
        productCursor = productConn.pageInfo.endCursor;
      }
      total++;
    }

    hasNextPage = pageInfo.hasNextPage as boolean;
    cursor = pageInfo.endCursor as string | null;
  }
  return total;
}

export async function syncAll(): Promise<void> {
  const products = await syncProducts();
  console.log(`[sync] Products: ${products}`);
  const collections = await syncCollections();
  console.log(`[sync] Collections: ${collections}`);
}