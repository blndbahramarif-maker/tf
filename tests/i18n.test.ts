import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  ALL_LOCALES,
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALES,
  getDirection,
  isEnabledLocale,
  isLocale,
  matchLocale,
} from '@kurdora/i18n';

const messagesDir = path.resolve(__dirname, '../packages/i18n/messages');

function loadCatalogue(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(messagesDir, `${locale}.json`), 'utf8'));
}

/** Flattens to dotted key paths so we can compare catalogue shapes. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locale registry', () => {
  it('defines Sorani and Kurmanji as separate locales with different directions', () => {
    // The single most important i18n fact for this product: these are not two
    // spellings of one language. Sorani is Arabic script and RTL; Kurmanji is
    // Latin script and LTR. See docs/09-i18n-rtl.md.
    expect(LOCALES.ckb.direction).toBe('rtl');
    expect(LOCALES.ckb.script).toBe('Arab');
    expect(LOCALES.kmr.direction).toBe('ltr');
    expect(LOCALES.kmr.script).toBe('Latn');
  });

  it('marks Arabic as right-to-left and English as left-to-right', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
  });

  it('enables exactly the launch locales', () => {
    // Launch is English + Sorani (docs/12-decisions-log.md, DL-4).
    expect(ENABLED_LOCALES).toEqual(['en', 'ckb']);
  });

  it('keeps disabled locales routable so their URLs do not 404', () => {
    expect(ALL_LOCALES).toContain('kmr');
    expect(ALL_LOCALES).toContain('ar');
    expect(isLocale('kmr')).toBe(true);
    expect(isEnabledLocale('kmr')).toBe(false);
  });

  it('rejects unknown locale codes', () => {
    expect(isLocale('ku')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('uses English as the default', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('matchLocale', () => {
  it('falls back to the default when the header is absent', () => {
    expect(matchLocale(null)).toBe('en');
    expect(matchLocale('')).toBe('en');
  });

  it('matches an exact enabled locale', () => {
    expect(matchLocale('ckb')).toBe('ckb');
  });

  it('matches a regional variant to its base language', () => {
    expect(matchLocale('ckb-IQ,en;q=0.5')).toBe('ckb');
  });

  it('respects quality ordering', () => {
    expect(matchLocale('en;q=0.2,ckb;q=0.9')).toBe('ckb');
  });

  it('never returns a disabled locale', () => {
    // Kurmanji is routable but not yet offered, so a kmr browser gets English.
    expect(matchLocale('kmr')).toBe('en');
  });
});

describe('message catalogues', () => {
  const reference = keyPaths(loadCatalogue(DEFAULT_LOCALE)).sort();

  it('has a catalogue file for every registered locale', () => {
    const files = readdirSync(messagesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''))
      .sort();
    expect(files).toEqual([...ALL_LOCALES].sort());
  });

  it.each(ALL_LOCALES)('catalogue "%s" has exactly the same keys as English', (locale) => {
    // Adding a key to en.json and forgetting the others is the normal way
    // translations rot. This makes it a build failure instead.
    expect(keyPaths(loadCatalogue(locale)).sort()).toEqual(reference);
  });

  it.each(ALL_LOCALES)('catalogue "%s" has no empty strings', (locale) => {
    const catalogue = loadCatalogue(locale);
    const empties: string[] = [];
    const walk = (value: unknown, prefix: string) => {
      if (typeof value === 'string') {
        if (value.trim() === '') empties.push(prefix);
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          walk(child, prefix ? `${prefix}.${key}` : key);
        }
      }
    };
    walk(catalogue, '');
    expect(empties).toEqual([]);
  });
});
