import {
  parseFiltersParam,
  categoryCondition,
  filtersConditions,
  buildProductWhere,
} from '../utils/product-query';

describe('parseFiltersParam', () => {
  it('parses valid JSON object of string arrays', () => {
    expect(parseFiltersParam('{"shape":["Round","Oval"],"clarity":["FL"]}')).toEqual({
      shape: ['Round', 'Oval'],
      clarity: ['FL'],
    });
  });

  it('returns undefined for garbage, non-objects, and empty selections', () => {
    expect(parseFiltersParam('not json')).toBeUndefined();
    expect(parseFiltersParam('["a"]')).toBeUndefined();
    expect(parseFiltersParam('{"shape":[]}')).toBeUndefined();
    expect(parseFiltersParam(undefined)).toBeUndefined();
  });

  it('drops non-string values inside arrays', () => {
    expect(parseFiltersParam('{"shape":["Round",5]}')).toEqual({ shape: ['Round'] });
  });
});

describe('filtersConditions', () => {
  it('produces one jsonb_exists_any condition per section with bound values', () => {
    const conds = filtersConditions({ shape: ['Round', 'Oval'] });
    expect(conds).toHaveLength(1);
    expect(conds[0].text).toContain('jsonb_exists_any');
    expect(conds[0].values).toEqual(expect.arrayContaining(['shape', ['Round', 'Oval']]));
  });
});

describe('categoryCondition', () => {
  it.each(['lab-grown', 'moissanite', 'natural', 'gemstone', 'other'])(
    'builds SQL for %s',
    (cat) => {
      const cond = categoryCondition(cat);
      expect(cond).not.toBeNull();
      // The metafield key is a bound parameter, so `growth_type` may appear in
      // either the SQL text (via HAS_GROWTH's literal `metafields->'growth_type'`)
      // or the bound values (via metafieldArray('growth_type')).
      const serialized = cond!.text + JSON.stringify(cond!.values);
      expect(serialized).toContain('growth_type');
    }
  );

  it('returns null for unknown categories', () => {
    expect(categoryCondition('rings')).toBeNull();
  });

  it('includes a tag fallback for lab-grown', () => {
    expect(categoryCondition('lab-grown')!.text.toLowerCase()).toContain('unnest(tags)');
  });
});

describe('buildProductWhere', () => {
  it('always includes availableForSale and ANDs all parts', () => {
    const where = buildProductWhere({
      category: 'moissanite',
      filters: { shape: ['Round'] },
      minPrice: 100,
      maxPrice: 500,
    });
    expect(where.text).toContain('"availableForSale" = true');
    expect(where.text).toContain('jsonb_exists_any');
    expect(where.text).toContain('"minPrice" >=');
    expect(where.text).toContain('"minPrice" <=');
  });
});
