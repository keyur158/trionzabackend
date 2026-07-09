import { prisma } from '../config/database';
import { shopifyGraphQL } from '../config/shopify';
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
          metafields(first: 25, namespace: "custom") {
            edges { node { key value } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export interface MetaobjectEntry {
  gid: string;
  handle: string;
  label: string;
}

export interface MetaobjectCatalog {
  labelByGid: Map<string, string>;
  entriesByType: Map<string, MetaobjectEntry[]>;
}

const METAOBJECT_DEFINITIONS_QUERY = `
  query GetMetaobjectDefinitions($after: String) {
    metaobjectDefinitions(first: 100, after: $after) {
      edges { node { type } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// No sortKey: the Admin API's default order is creation order, which is the
// order entries were defined in the store — our canonical filter-option order.
const METAOBJECTS_QUERY = `
  query GetMetaobjects($type: String!, $after: String) {
    metaobjects(type: $type, first: 250, after: $after) {
      edges { node { id handle displayName fields { key value } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function buildMetaobjectCatalog(): Promise<MetaobjectCatalog> {
  const labelByGid = new Map<string, string>();
  const entriesByType = new Map<string, MetaobjectEntry[]>();

  const types: string[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  while (hasNextPage) {
    const res = await shopifyGraphQL(METAOBJECT_DEFINITIONS_QUERY, { after: cursor });
    const conn = res.data?.metaobjectDefinitions;
    if (!conn) break;
    for (const { node } of conn.edges) types.push(node.type as string);
    hasNextPage = conn.pageInfo.hasNextPage as boolean;
    cursor = conn.pageInfo.endCursor as string | null;
  }

  for (const type of types) {
    const entries: MetaobjectEntry[] = [];
    let more = true;
    let after: string | null = null;
    while (more) {
      let res;
      try {
        res = await shopifyGraphQL(METAOBJECTS_QUERY, { type, after });
      } catch (err) {
        // One type failing must not drop label resolution for the others.
        console.warn(`[sync] Failed to load metaobjects for type "${type}":`, err);
        break;
      }
      const conn = res.data?.metaobjects;
      if (!conn) break;
      for (const { node } of conn.edges) {
        const labelField = (node.fields as Array<{ key: string; value: string | null }>)
          .find(f => f.key === 'label');
        const label =
          labelField?.value || (node.displayName as string) || (node.handle as string);
        labelByGid.set(node.id as string, label);
        entries.push({ gid: node.id as string, handle: node.handle as string, label });
      }
      more = conn.pageInfo.hasNextPage as boolean;
      after = conn.pageInfo.endCursor as string | null;
    }
    if (entries.length > 0) entriesByType.set(type, entries);
  }

  return { labelByGid, entriesByType };
}

export async function persistFilterOptions(catalog: MetaobjectCatalog): Promise<void> {
  for (const [type, entries] of catalog.entriesByType) {
    await prisma.$transaction([
      prisma.filterOption.deleteMany({ where: { type } }),
      prisma.filterOption.createMany({
        data: entries.map((e, i) => ({ type, handle: e.handle, label: e.label, position: i })),
      }),
    ]);
  }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapProductNode(node: any, labelByGid: Map<string, string>) {
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
  const mfEdges =
    (node.metafields as { edges: Array<{ node: { key: string; value: string } }> } | null)
      ?.edges ?? [];
  for (const { node: mf } of mfEdges) {
    if (!mf?.key || !mf?.value) continue;
    const resolved = resolveMetafieldValue(mf.value, labelByGid);
    if (resolved !== null) metafields[mf.key] = resolved;
  }

  return {
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
  };
}

export async function syncProducts(): Promise<number> {
  let hasNextPage = true;
  let cursor: string | null = null;
  let total = 0;

  const catalog = await buildMetaobjectCatalog();
  console.log(`[sync] Loaded ${catalog.labelByGid.size} metaobject labels across ${catalog.entriesByType.size} types`);

  try {
    await persistFilterOptions(catalog);
  } catch (err) {
    console.warn('[sync] Failed to persist filter options:', err);
  }

  while (hasNextPage) {
    const data = await shopifyGraphQL(PRODUCTS_QUERY, { first: 50, after: cursor });
    const { edges, pageInfo } = data.data.products;

    for (const { node } of edges) {
      try {
        await upsertProduct(mapProductNode(node, catalog.labelByGid));
        total++;
      } catch (err: any) {
        const msg = err?.message || err?.toString() || String(err);
        console.warn(`[sync] Skipping product ${extractId(node.id as string)} (${node.handle}): ${msg}`);
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