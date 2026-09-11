import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { brand } from '@kurdora/brand';

const root = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', '.next', 'dist', 'coverage', '.git'].includes(entry)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('brand abstraction', () => {
  it('exposes a brand name', () => {
    expect(brand.name).toBeTruthy();
  });

  it('is a UK entity, matching the platform decision', () => {
    // DL-1: UK private limited company. This drives the Stripe platform
    // country and therefore the whole payment architecture.
    expect(brand.legalEntity.jurisdiction).toBe('England and Wales');
  });

  it('keeps the Stripe statement descriptor within the 22-character limit', () => {
    expect(brand.statementDescriptor.length).toBeLessThanOrEqual(22);
  });

  it('does not hard-code the brand name in components or app code', () => {
    // Renaming the platform must be a config edit, not a refactor.
    // See docs/09-i18n-rtl.md ("Brand abstraction").
    const sources = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))];

    const offenders = sources.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      // Strip comments — explanatory prose may name the brand.
      const code = contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      return code.includes(brand.name);
    });

    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('does not hard-code the brand name in message catalogue values', () => {
    // Catalogues must interpolate {brandName} instead.
    const dir = path.join(root, 'packages/i18n/messages');
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const catalogue = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      const walkValues = (value: unknown, keyPath: string) => {
        if (typeof value === 'string') {
          if (value.includes(brand.name)) offenders.push(`${file}:${keyPath}`);
          return;
        }
        if (typeof value === 'object' && value !== null) {
          for (const [key, child] of Object.entries(value)) {
            walkValues(child, keyPath ? `${keyPath}.${key}` : key);
          }
        }
      };
      walkValues(catalogue, '');
    }

    expect(offenders).toEqual([]);
  });
});
