import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_TEXT_LENGTH,
  decodeCursor,
  encodeCursor,
  normaliseText,
  parseSearchQuery,
} from '@/domain/search/query';

/**
 * Search parameters arrive from the open internet. Everything here is about
 * bounding them before they reach the database.
 */

describe('text normalisation', () => {
  it('collapses whitespace and trims', () => {
    expect(normaliseText('  bmw   320d  ')).toBe('bmw 320d');
  });

  it('caps length, because a huge query is never legitimate', () => {
    expect(normaliseText('x'.repeat(500))).toHaveLength(MAX_TEXT_LENGTH);
  });

  it('leaves Sorani text intact', () => {
    expect(normaliseText('کراس و ڕانک')).toBe('کراس و ڕانک');
  });
});

describe('parseSearchQuery', () => {
  it('defaults to newest with no search term', () => {
    const query = parseSearchQuery({});
    expect(query.sort).toBe('newest');
    expect(query.limit).toBe(DEFAULT_LIMIT);
    expect(query.text).toBeNull();
  });

  it('defaults to relevance when there IS a term', () => {
    expect(parseSearchQuery({ q: 'bmw' }).sort).toBe('relevance');
  });

  it('caps the page size', () => {
    expect(parseSearchQuery({ limit: '5000' }).limit).toBe(MAX_LIMIT);
    expect(parseSearchQuery({ limit: '0' }).limit).toBe(1);
    expect(parseSearchQuery({ limit: 'abc' }).limit).toBe(DEFAULT_LIMIT);
  });

  it('rejects an unknown sort rather than passing it through', () => {
    expect(parseSearchQuery({ sort: 'DROP TABLE listings' }).sort).toBe('newest');
  });

  it('parses prices as integer minor units only', () => {
    expect(parseSearchQuery({ minPrice: '150000' }).minPriceMinor).toBe(150000n);
    // A decimal means someone is sending major units; refuse rather than guess.
    expect(parseSearchQuery({ minPrice: '1500.00' }).minPriceMinor).toBeNull();
    expect(parseSearchQuery({ minPrice: '-5' }).minPriceMinor).toBeNull();
  });

  it('discards malformed country, city, condition and seller type', () => {
    const query = parseSearchQuery({
      country: 'GBR',
      city: 'London; DROP',
      condition: 'new',
      sellerType: 'ADMIN',
    });
    expect(query.countryCode).toBeNull();
    expect(query.citySlug).toBeNull();
    expect(query.condition).toBeNull();
    expect(query.sellerType).toBeNull();
  });

  it('accepts well-formed values and upper-cases the country', () => {
    const query = parseSearchQuery({
      country: 'gb',
      city: 'london',
      condition: 'LIKE_NEW',
      sellerType: 'BUSINESS',
    });
    expect(query.countryCode).toBe('GB');
    expect(query.citySlug).toBe('london');
    expect(query.condition).toBe('LIKE_NEW');
    expect(query.sellerType).toBe('BUSINESS');
  });

  it('ignores an attribute key that is not a plain identifier', () => {
    const query = parseSearchQuery({
      attributes: { "fuel'; DROP TABLE listings--": ['diesel'], fuel_type: ['diesel'] },
    });
    expect(query.attributes).toHaveLength(1);
    expect(query.attributes[0]?.key).toBe('fuel_type');
  });

  it('supports multi-value and range attribute filters', () => {
    const query = parseSearchQuery({
      attributes: { fuel_type: ['diesel', 'hybrid'], mileage: ['min:0', 'max:80000'] },
    });
    const fuel = query.attributes.find((f) => f.key === 'fuel_type');
    const mileage = query.attributes.find((f) => f.key === 'mileage');
    expect(fuel?.anyOf).toEqual(['diesel', 'hybrid']);
    expect(mileage?.min).toBe(0);
    expect(mileage?.max).toBe(80000);
  });

  it('bounds the number of attribute values', () => {
    const many = Array.from({ length: 200 }, (_, i) => `v${i}`);
    const query = parseSearchQuery({ attributes: { colour: many } });
    expect(query.attributes[0]?.anyOf?.length).toBeLessThanOrEqual(20);
  });

  it('rejects a category path containing anything unexpected', () => {
    expect(parseSearchQuery({ category: "/cars/'--" }).categoryPath).toBeNull();
    expect(parseSearchQuery({ category: '/cars/' }).categoryPath).toBe('/cars/');
  });
});

describe('cursor pagination', () => {
  it('round-trips', () => {
    const cursor = encodeCursor('0000000000000001234', 'listing-id');
    expect(decodeCursor(cursor)).toEqual({ value: '0000000000000001234', id: 'listing-id' });
  });

  it('handles a value containing the separator', () => {
    const cursor = encodeCursor('a|b|c', 'the-id');
    expect(decodeCursor(cursor)).toEqual({ value: 'a|b|c', id: 'the-id' });
  });

  it('returns null for a malformed cursor rather than throwing', () => {
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(Buffer.from('novalue').toString('base64url'))).toBeNull();
  });
});
