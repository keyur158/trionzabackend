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

import { shopifyGraphQL } from '../config/shopify';
import { buildMetaobjectCatalog } from '../services/shopify-sync';

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