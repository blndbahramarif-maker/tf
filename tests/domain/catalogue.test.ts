import { describe, expect, it } from 'vitest';
import {
  availableTransitions,
  canTransition,
  isEditable,
  isPubliclyVisible,
  LISTING_TRANSITIONS,
  publishTarget,
  type ListingStatus,
} from '@/domain/catalogue/listing-status';
import {
  isCanonicalSlug,
  listingPath,
  slugify,
  slugifyWithFallback,
} from '@/domain/catalogue/slug';
import {
  ancestorPaths,
  buildPath,
  buildTree,
  depthOf,
  isDescendantOf,
  resolveAttributes,
} from '@/domain/catalogue/category-tree';
import { validateAttributes, type AttributeDefinition } from '@/domain/catalogue/attributes';

describe('listing lifecycle', () => {
  it('lets an owner publish a draft', () => {
    expect(canTransition('DRAFT', 'ACTIVE', 'owner').allowed).toBe(true);
  });

  it('sends a draft to review when the CATEGORY requires approval', () => {
    // A per-category flag, never a check against a category name.
    expect(publishTarget(true)).toBe('PENDING_REVIEW');
    expect(publishTarget(false)).toBe('ACTIVE');
  });

  it('does NOT let an owner approve their own listing', () => {
    // The whole point of review: self-approval would defeat it.
    const decision = canTransition('PENDING_REVIEW', 'ACTIVE', 'owner');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('actor_not_allowed');
  });

  it('lets a moderator approve or reject', () => {
    expect(canTransition('PENDING_REVIEW', 'ACTIVE', 'moderator').allowed).toBe(true);
    expect(canTransition('PENDING_REVIEW', 'REJECTED', 'moderator').allowed).toBe(true);
  });

  it('does NOT let an owner resurrect a listing a moderator removed', () => {
    expect(canTransition('REMOVED', 'ACTIVE', 'owner').allowed).toBe(false);
    expect(canTransition('REMOVED', 'DRAFT', 'owner').allowed).toBe(false);
  });

  it('lets only the system expire a listing', () => {
    expect(canTransition('ACTIVE', 'EXPIRED', 'system').allowed).toBe(true);
    expect(canTransition('ACTIVE', 'EXPIRED', 'owner').allowed).toBe(false);
  });

  it('rejects a transition that is not in the table at all', () => {
    const decision = canTransition('DRAFT', 'SOLD', 'owner');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('not_permitted');
  });

  it('rejects a no-op', () => {
    const decision = canTransition('ACTIVE', 'ACTIVE', 'owner');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('same_status');
  });

  it('only publishes ACTIVE listings', () => {
    const statuses: ListingStatus[] = [
      'DRAFT',
      'PENDING_REVIEW',
      'ACTIVE',
      'PAUSED',
      'SOLD',
      'EXPIRED',
      'REJECTED',
      'REMOVED',
    ];
    expect(statuses.filter(isPubliclyVisible)).toEqual(['ACTIVE']);
  });

  it('does not allow editing a live listing in place', () => {
    // A published listing must be paused first, so it cannot silently become a
    // different item after buyers have seen it.
    expect(isEditable('ACTIVE')).toBe(false);
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('PAUSED')).toBe(true);
    expect(isEditable('REJECTED')).toBe(true);
  });

  it('offers a UI exactly the transitions that will succeed', () => {
    for (const transition of availableTransitions('ACTIVE', 'owner')) {
      expect(canTransition('ACTIVE', transition.to, 'owner').allowed).toBe(true);
    }
  });

  it('has no duplicate rows in the transition table', () => {
    const seen = new Set<string>();
    for (const transition of LISTING_TRANSITIONS) {
      const key = `${transition.from}->${transition.to}`;
      expect(seen.has(key), `duplicate transition ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('slug generation', () => {
  it('produces a clean slug from an English title', () => {
    expect(slugify('BMW 320d M Sport — 2018, Low Mileage!')).toBe(
      'bmw-320d-m-sport-2018-low-mileage',
    );
  });

  it('strips Latin diacritics', () => {
    expect(slugify('Café Möbel')).toBe('cafe-mobel');
  });

  it('KEEPS Sorani letters rather than stripping the title to nothing', () => {
    // The failure mode this guards: a naive [a-z0-9] filter turns every
    // Kurdish title into an empty slug.
    const slug = slugify('کراس و ڕانک');
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toContain('کراس');
    expect(slug).toContain('-');
  });

  it('keeps Arabic letters', () => {
    expect(slugify('سيارة للبيع').length).toBeGreaterThan(0);
  });

  it('falls back when a title yields nothing usable', () => {
    expect(slugify('!!! ???')).toBe('');
    expect(slugifyWithFallback('!!! ???', 'cars')).toBe('cars');
    expect(slugifyWithFallback('🚗🚗🚗', 'cars')).toBe('cars');
  });

  it('truncates on a word boundary', () => {
    const slug = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('builds a path with the id first, so a renamed listing never 404s', () => {
    const path = listingPath('en', 'abc-123', 'bmw-320d');
    expect(path).toBe('/en/listing/abc-123/bmw-320d');
    // Even with no slug at all, the path still resolves.
    expect(listingPath('ckb', 'abc-123', '')).toBe('/ckb/listing/abc-123');
  });

  it('percent-encodes a non-Latin slug for the URL', () => {
    const path = listingPath('ckb', 'id-1', slugify('کراس و ڕانک'));
    expect(path.startsWith('/ckb/listing/id-1/')).toBe(true);
    expect(path).toContain('%');
  });

  it('detects a non-canonical slug so the route can redirect', () => {
    expect(isCanonicalSlug('bmw-320d', 'bmw-320d')).toBe(true);
    expect(isCanonicalSlug('old-name', 'bmw-320d')).toBe(false);
    expect(isCanonicalSlug(undefined, 'bmw-320d')).toBe(false);
  });
});

describe('category tree', () => {
  it('builds delimited paths', () => {
    expect(buildPath(null, 'cars')).toBe('/cars/');
    expect(buildPath('/vehicles/', 'cars')).toBe('/vehicles/cars/');
  });

  it('computes depth from a path', () => {
    expect(depthOf('/cars/')).toBe(0);
    expect(depthOf('/vehicles/cars/')).toBe(1);
    expect(depthOf('/vehicles/cars/electric/')).toBe(2);
  });

  it('lists ancestors nearest first', () => {
    expect(ancestorPaths('/vehicles/cars/electric/')).toEqual(['/vehicles/cars/', '/vehicles/']);
    expect(ancestorPaths('/cars/')).toEqual([]);
  });

  it('does not treat a lookalike sibling as a descendant', () => {
    // The reason paths are delimited at both ends: `/car/` must not match
    // `/cargo/`.
    expect(isDescendantOf('/cargo/', '/car/')).toBe(false);
    expect(isDescendantOf('/vehicles/cars/', '/vehicles/')).toBe(true);
    expect(isDescendantOf('/vehicles/', '/vehicles/')).toBe(false);
  });

  it('assembles a tree ordered by position', () => {
    const nodes = [
      { id: 'b', parentId: null, slug: 'b', path: '/b/', depth: 0, position: 2, isActive: true },
      { id: 'a', parentId: null, slug: 'a', path: '/a/', depth: 0, position: 1, isActive: true },
      {
        id: 'a1',
        parentId: 'a',
        slug: 'a1',
        path: '/a/a1/',
        depth: 1,
        position: 1,
        isActive: true,
      },
    ];
    const tree = buildTree(nodes);
    expect(tree.map((n) => n.node.id)).toEqual(['a', 'b']);
    expect(tree[0]?.children.map((n) => n.node.id)).toEqual(['a1']);
  });

  it('keeps a node whose parent is missing rather than dropping it', () => {
    const tree = buildTree([
      {
        id: 'orphan',
        parentId: 'gone',
        slug: 'o',
        path: '/o/',
        depth: 1,
        position: 1,
        isActive: true,
      },
    ]);
    expect(tree).toHaveLength(1);
  });
});

describe('attribute inheritance', () => {
  const attribute = (
    id: string,
    key: string,
    categoryId: string,
    inherit = true,
    position = 1,
  ) => ({
    id,
    key,
    categoryId,
    inheritToChildren: inherit,
    position,
  });

  it('inherits an ancestor attribute', () => {
    const resolved = resolveAttributes(
      [attribute('own', 'mileage', 'cars')],
      [attribute('anc', 'make', 'vehicles')],
    );
    expect(resolved.map((a) => a.key).sort()).toEqual(['make', 'mileage']);
  });

  it('lets a child OVERRIDE an inherited key', () => {
    const resolved = resolveAttributes(
      [attribute('own', 'make', 'cars')],
      [attribute('anc', 'make', 'vehicles')],
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe('own');
  });

  it('does not inherit an attribute marked non-inheritable', () => {
    const resolved = resolveAttributes([], [attribute('anc', 'private', 'vehicles', false)]);
    expect(resolved).toHaveLength(0);
  });

  it('prefers the NEAREST ancestor when two define the same key', () => {
    const resolved = resolveAttributes(
      [],
      [attribute('near', 'make', 'cars'), attribute('far', 'make', 'vehicles')],
    );
    expect(resolved[0]?.id).toBe('near');
  });
});

describe('attribute validation', () => {
  const definitions: AttributeDefinition[] = [
    { id: 'd-make', key: 'make', dataType: 'TEXT', isRequired: true, validation: {}, options: [] },
    {
      id: 'd-year',
      key: 'year',
      dataType: 'INTEGER',
      isRequired: true,
      validation: { min: 1900, max: 2100 },
      options: [],
    },
    {
      id: 'd-fuel',
      key: 'fuel_type',
      dataType: 'ENUM',
      isRequired: false,
      validation: {},
      options: [
        { id: 'o-petrol', value: 'petrol' },
        { id: 'o-diesel', value: 'diesel' },
      ],
    },
    {
      id: 'd-sunroof',
      key: 'sunroof',
      dataType: 'BOOLEAN',
      isRequired: false,
      validation: {},
      options: [],
    },
    {
      id: 'd-extras',
      key: 'extras',
      dataType: 'MULTI_ENUM',
      isRequired: false,
      validation: {},
      options: [
        { id: 'o-alloy', value: 'alloy' },
        { id: 'o-tow', value: 'towbar' },
      ],
    },
    {
      id: 'd-mot',
      key: 'mot_expiry',
      dataType: 'DATE',
      isRequired: false,
      validation: {},
      options: [],
    },
  ];

  it('accepts a valid submission and produces BOTH shapes', () => {
    const result = validateAttributes(definitions, {
      make: 'BMW',
      year: 2018,
      fuel_type: 'diesel',
      sunroof: true,
      extras: ['alloy', 'towbar'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Normalised rows for integrity, JSONB projection for filtering.
    expect(result.rows.find((r) => r.key === 'make')?.valueText).toBe('BMW');
    expect(result.rows.find((r) => r.key === 'year')?.valueInteger).toBe(2018n);
    expect(result.rows.find((r) => r.key === 'fuel_type')?.optionId).toBe('o-diesel');
    // MULTI_ENUM produces one row per selection.
    expect(result.rows.filter((r) => r.key === 'extras')).toHaveLength(2);

    expect(result.json).toMatchObject({
      make: 'BMW',
      year: 2018,
      fuel_type: 'diesel',
      sunroof: true,
      extras: ['alloy', 'towbar'],
    });
  });

  it('reports a missing required field', () => {
    const result = validateAttributes(definitions, { year: 2018 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.key === 'make' && i.code === 'required')).toBe(true);
  });

  it('REJECTS an unknown attribute rather than silently dropping it', () => {
    // Silently discarding a field the seller filled in is worse than saying no.
    const result = validateAttributes(definitions, { make: 'BMW', year: 2018, horsepower: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((i) => i.key === 'horsepower' && i.code === 'unknown_attribute'),
    ).toBe(true);
  });

  it('enforces numeric range', () => {
    const result = validateAttributes(definitions, { make: 'BMW', year: 1800 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe('out_of_range');
  });

  it('rejects a non-integer for an INTEGER attribute', () => {
    const result = validateAttributes(definitions, { make: 'BMW', year: 2018.5 });
    expect(result.ok).toBe(false);
  });

  it('accepts a numeric STRING from a form field', () => {
    const result = validateAttributes(definitions, { make: 'BMW', year: '2018' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.json.year).toBe(2018);
  });

  it('never coerces a non-numeric string into NaN', () => {
    const result = validateAttributes(definitions, { make: 'BMW', year: 'two thousand' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe('wrong_type');
  });

  it('rejects a value that is not one of the enum options', () => {
    const result = validateAttributes(definitions, {
      make: 'BMW',
      year: 2018,
      fuel_type: 'nuclear',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe('not_an_option');
  });

  it('rejects an invalid entry inside a multi-select', () => {
    const result = validateAttributes(definitions, {
      make: 'BMW',
      year: 2018,
      extras: ['alloy', 'rocket-launcher'],
    });
    expect(result.ok).toBe(false);
  });

  it('parses a date and rejects nonsense', () => {
    const good = validateAttributes(definitions, {
      make: 'BMW',
      year: 2018,
      mot_expiry: '2027-03-01',
    });
    expect(good.ok).toBe(true);
    const bad = validateAttributes(definitions, { make: 'BMW', year: 2018, mot_expiry: 'someday' });
    expect(bad.ok).toBe(false);
  });

  it('treats an empty string as absent', () => {
    const result = validateAttributes(definitions, { make: 'BMW', year: 2018, fuel_type: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.json.fuel_type).toBeUndefined();
  });

  it('enforces a text length cap', () => {
    const capped: AttributeDefinition[] = [
      {
        id: 'd',
        key: 'note',
        dataType: 'TEXT',
        isRequired: false,
        validation: { maxLength: 10 },
        options: [],
      },
    ];
    expect(validateAttributes(capped, { note: 'x'.repeat(11) }).ok).toBe(false);
    expect(validateAttributes(capped, { note: 'x'.repeat(10) }).ok).toBe(true);
  });

  it('survives a malformed admin regex instead of rejecting everything', () => {
    const broken: AttributeDefinition[] = [
      {
        id: 'd',
        key: 'reg',
        dataType: 'TEXT',
        isRequired: false,
        validation: { pattern: '([unclosed' },
        options: [],
      },
    ];
    expect(validateAttributes(broken, { reg: 'AB12 CDE' }).ok).toBe(true);
  });

  it('anchors an admin pattern so a partial match does not pass', () => {
    const anchored: AttributeDefinition[] = [
      {
        id: 'd',
        key: 'reg',
        dataType: 'TEXT',
        isRequired: false,
        validation: { pattern: '[A-Z]{2}\\d{2}' },
        options: [],
      },
    ];
    expect(validateAttributes(anchored, { reg: 'AB12' }).ok).toBe(true);
    expect(validateAttributes(anchored, { reg: 'xxAB12xx' }).ok).toBe(false);
  });

  it('validates against DEFINITIONS PASSED IN, with no knowledge of categories', () => {
    // The same function serves Cars and Kurdish Clothing; nothing here knows
    // either name.
    const clothing: AttributeDefinition[] = [
      {
        id: 'd-type',
        key: 'garment_type',
        dataType: 'ENUM',
        isRequired: true,
        validation: {},
        options: [{ id: 'o-kras', value: 'kras_u_rank' }],
      },
    ];
    expect(validateAttributes(clothing, { garment_type: 'kras_u_rank' }).ok).toBe(true);
    expect(validateAttributes(clothing, { make: 'BMW' }).ok).toBe(false);
  });
});
