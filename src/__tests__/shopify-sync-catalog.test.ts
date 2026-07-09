jest.mock('../config/shopify', () => ({
  shopifyGraphQL: jest.fn(),
  shopifyStorefrontGraphQL: jest.fn(),
}));
jest.mock('../config/database', () => ({
  prisma: {
    filterOption: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  },
}));
jest.mock('../services/product-sync', () => ({
  upsertProduct: jest.fn(),
}));

import { shopifyGraphQL } from '../config/shopify';
import { buildMetaobjectCatalog, syncProducts } from '../services/shopify-sync';
import { upsertProduct } from '../services/product-sync';

const mockGraphQL = shopifyGraphQL as jest.Mock;

function definitionsPage(types: string[]) {
  return {
    data: {
      metaobjectDefinitions: {
        edges: types.map(t => ({ node: { type: t } })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

function metaobjectsPage(nodes: Array<{ id: string; handle: string; displayName?: string; label?: string }>) {
  return {
    data: {
      metaobjects: {
        edges: nodes.map(n => ({
          node: {
            id: n.id,
            handle: n.handle,
            displayName: n.displayName ?? n.handle,
            fields: n.label !== undefined ? [{ key: 'label', value: n.label }] : [],
          },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

describe('buildMetaobjectCatalog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('discovers all types and maps gid -> label in defined order', async () => {
    mockGraphQL
      .mockResolvedValueOnce(definitionsPage(['clarity', 'growth_type']))
      .mockResolvedValueOnce(metaobjectsPage([
        { id: 'gid://shopify/Metaobject/1', handle: 'fl', label: 'FL' },
        { id: 'gid://shopify/Metaobject/2', handle: 'if', label: 'IF' },
      ]))
      .mockResolvedValueOnce(metaobjectsPage([
        { id: 'gid://shopify/Metaobject/3', handle: 'hpht', label: 'HPHT' },
      ]));

    const catalog = await buildMetaobjectCatalog();

    expect(catalog.labelByGid.get('gid://shopify/Metaobject/1')).toBe('FL');
    expect(catalog.labelByGid.get('gid://shopify/Metaobject/3')).toBe('HPHT');
    expect(catalog.entriesByType.get('clarity')).toEqual([
      { gid: 'gid://shopify/Metaobject/1', handle: 'fl', label: 'FL' },
      { gid: 'gid://shopify/Metaobject/2', handle: 'if', label: 'IF' },
    ]);
  });

  it('falls back to displayName then handle when no label field exists', async () => {
    mockGraphQL
      .mockResolvedValueOnce(definitionsPage(['shape']))
      .mockResolvedValueOnce(metaobjectsPage([
        { id: 'gid://shopify/Metaobject/9', handle: 'round', displayName: 'Round' },
      ]));

    const catalog = await buildMetaobjectCatalog();
    expect(catalog.labelByGid.get('gid://shopify/Metaobject/9')).toBe('Round');
  });

  it('tolerates a failing type without dropping the others', async () => {
    mockGraphQL
      .mockResolvedValueOnce(definitionsPage(['bad_type', 'shape']))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(metaobjectsPage([
        { id: 'gid://shopify/Metaobject/9', handle: 'round', label: 'Round' },
      ]));

    const catalog = await buildMetaobjectCatalog();
    expect(catalog.entriesByType.has('bad_type')).toBe(false);
    expect(catalog.entriesByType.get('shape')).toHaveLength(1);
  });

  it('logs loudly and returns an empty catalog when the definitions query errors (missing scopes)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGraphQL.mockResolvedValueOnce({
      errors: [{ code: 'ACCESS_DENIED' }],
      data: null,
    });

    const catalog = await buildMetaobjectCatalog();

    expect(catalog.labelByGid.size).toBe(0);
    expect(catalog.entriesByType.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Metaobject query returned errors'),
      expect.stringContaining('ACCESS_DENIED')
    );
    errorSpy.mockRestore();
  });
});

describe('syncProducts with an empty metaobject catalog', () => {
  beforeEach(() => jest.clearAllMocks());

  function productsPage(nodes: Array<{ id: string; metafieldValue: string | null }>) {
    return {
      data: {
        products: {
          edges: nodes.map(n => ({
            node: {
              id: n.id,
              title: 'Test Ring',
              handle: 'test-ring',
              descriptionHtml: '<p>desc</p>',
              vendor: 'Trionza',
              productType: 'Ring',
              tags: ['lab grown'],
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-02T00:00:00Z',
              publishedAt: '2024-01-01T00:00:00Z',
              images: { edges: [] },
              variants: {
                edges: [{
                  node: {
                    id: 'gid://shopify/ProductVariant/1',
                    title: 'Default',
                    price: '100.00',
                    compareAtPrice: null,
                    availableForSale: true,
                    sku: 'SKU-1',
                    inventoryQuantity: 5,
                    selectedOptions: [],
                    image: null,
                  },
                }],
              },
              metafields: {
                edges: n.metafieldValue
                  ? [{ node: { key: 'growth_type', value: n.metafieldValue } }]
                  : [],
              },
            },
          })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };
  }

  it('calls upsertProduct with metafields undefined when the catalog is empty (never wipes stored metafields)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGraphQL
      // buildMetaobjectCatalog: definitions query returns no types
      .mockResolvedValueOnce(definitionsPage([]))
      // syncProducts: one page of products, whose metaobject-reference metafield
      // cannot resolve to a label because the catalog is empty
      .mockResolvedValueOnce(
        productsPage([{ id: 'gid://shopify/Product/1', metafieldValue: 'gid://shopify/Metaobject/999' }])
      );

    const total = await syncProducts();

    expect(total).toBe(1);
    expect(upsertProduct).toHaveBeenCalledTimes(1);
    const payload = (upsertProduct as jest.Mock).mock.calls[0][0];
    expect(payload.metafields).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Metaobject catalog is EMPTY'));
    warnSpy.mockRestore();
  });
});

import { prisma } from '../config/database';
import { persistFilterOptions } from '../services/shopify-sync';

describe('persistFilterOptions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('replaces each type atomically with positions in catalog order', async () => {
    await persistFilterOptions({
      labelByGid: new Map(),
      entriesByType: new Map([
        ['clarity', [
          { gid: 'g1', handle: 'fl', label: 'FL' },
          { gid: 'g2', handle: 'if', label: 'IF' },
        ]],
      ]),
    });

    expect(prisma.filterOption.deleteMany).toHaveBeenCalledWith({ where: { type: 'clarity' } });
    expect(prisma.filterOption.createMany).toHaveBeenCalledWith({
      data: [
        { type: 'clarity', handle: 'fl', label: 'FL', position: 0 },
        { type: 'clarity', handle: 'if', label: 'IF', position: 1 },
      ],
    });
  });
});