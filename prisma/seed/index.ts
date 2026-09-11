/**
 * Idempotent seed runner.
 *
 *   pnpm db:seed
 *
 * Every write is an upsert keyed on a natural business key, so running this
 * repeatedly converges on the same state rather than accumulating duplicates.
 * That matters because seeds run on every developer machine, in CI on every
 * push, and on staging after every deploy — a seed that is only safe once is
 * a seed that will corrupt something.
 *
 * Idempotency is verified by tests/db/seed.test.ts, which seeds twice and
 * asserts the row counts are identical.
 *
 * This seeds CONFIGURATION only: countries, currencies, categories, roles,
 * commission rules, settings. It creates no users, listings or orders.
 * Demo fixtures belong in a separate, explicitly-invoked script so they can
 * never reach production by accident.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import {
  CATEGORIES,
  CITIES,
  COMMISSION_RULES,
  COUNTRIES,
  CURRENCIES,
  PERMISSIONS,
  PROHIBITED_RULES,
  ROLES,
  SETTINGS,
  type CategorySeed,
} from './data';

const LOCALES = ['en', 'ckb', 'kmr', 'ar'] as const;

export interface SeedOptions {
  databaseUrl: string;
  log?: (message: string) => void;
}

export interface SeedResult {
  currencies: number;
  countries: number;
  cities: number;
  categories: number;
  attributes: number;
  permissions: number;
  roles: number;
  commissionRules: number;
  settings: number;
  prohibitedRules: number;
}

export async function seed(options: SeedOptions): Promise<SeedResult> {
  const log = options.log ?? (() => {});
  const adapter = new PrismaPg({ connectionString: options.databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    // ── Currencies ───────────────────────────────────────────────────────────
    for (const currency of CURRENCIES) {
      await prisma.currency.upsert({
        where: { code: currency.code },
        create: {
          code: currency.code,
          minorUnitDigits: currency.minorUnitDigits,
          symbol: currency.symbol,
          isActive: currency.isActive,
          position: currency.position,
        },
        // Deliberately does NOT reset isActive: an admin who activated SEK
        // should not have that undone by the next deploy's seed run.
        update: {
          minorUnitDigits: currency.minorUnitDigits,
          symbol: currency.symbol,
          position: currency.position,
        },
      });
    }
    log(`  currencies      ${CURRENCIES.length}`);

    // ── Countries and their translations ─────────────────────────────────────
    for (const country of COUNTRIES) {
      const record = await prisma.country.upsert({
        where: { code: country.code },
        create: {
          code: country.code,
          defaultCurrency: country.defaultCurrency,
          isActive: country.isActive,
          payoutsSupported: country.payoutsSupported,
          phonePrefix: country.phonePrefix,
          timezone: country.timezone,
          position: country.position,
        },
        update: {
          defaultCurrency: country.defaultCurrency,
          payoutsSupported: country.payoutsSupported,
          phonePrefix: country.phonePrefix,
          timezone: country.timezone,
          position: country.position,
        },
      });

      for (const locale of LOCALES) {
        const name = country.names[locale];
        if (!name) continue;
        await prisma.countryTranslation.upsert({
          where: { countryId_locale: { countryId: record.id, locale } },
          create: { countryId: record.id, locale, name },
          update: { name },
        });
      }
    }
    log(`  countries       ${COUNTRIES.length}`);

    // ── Cities ───────────────────────────────────────────────────────────────
    for (const city of CITIES) {
      const country = await prisma.country.findUnique({ where: { code: city.countryCode } });
      if (!country)
        throw new Error(`Seed error: country ${city.countryCode} missing for ${city.name}`);

      await prisma.city.upsert({
        where: { countryId_slug: { countryId: country.id, slug: city.slug } },
        create: {
          countryId: country.id,
          name: city.name,
          slug: city.slug,
          population: city.population,
        },
        update: { name: city.name, population: city.population },
      });
    }
    log(`  cities          ${CITIES.length}`);

    // ── Categories, attributes and options ───────────────────────────────────
    let attributeCount = 0;
    for (const category of CATEGORIES) {
      attributeCount += await upsertCategory(prisma, category);
    }
    log(`  categories      ${CATEGORIES.length} (${attributeCount} attributes)`);

    // ── Permissions ──────────────────────────────────────────────────────────
    for (const permission of PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: permission,
        update: { category: permission.category, description: permission.description },
      });
    }
    log(`  permissions     ${PERMISSIONS.length}`);

    // ── Roles and their grants ───────────────────────────────────────────────
    for (const role of ROLES) {
      const record = await prisma.role.upsert({
        where: { key: role.key },
        create: {
          key: role.key,
          description: role.description,
          isSystem: true,
          requiresTwoFactor: role.requiresTwoFactor,
        },
        update: {
          description: role.description,
          requiresTwoFactor: role.requiresTwoFactor,
        },
      });

      const keys = role.permissions === '*' ? PERMISSIONS.map((p) => p.key) : role.permissions;
      const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });

      if (permissions.length !== keys.length) {
        const found = new Set(permissions.map((p) => p.key));
        const missing = keys.filter((k) => !found.has(k));
        throw new Error(
          `Seed error: role "${role.key}" references unknown permissions: ${missing.join(', ')}`,
        );
      }

      // Replace the grant set so a permission REMOVED from a role in code is
      // actually revoked. A seed that only ever adds would silently let
      // privileges accumulate — the opposite of least privilege.
      await prisma.rolePermission.deleteMany({
        where: { roleId: record.id, permissionId: { notIn: permissions.map((p) => p.id) } },
      });

      for (const permission of permissions) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: record.id, permissionId: permission.id } },
          create: { roleId: record.id, permissionId: permission.id },
          update: {},
        });
      }
    }
    log(`  roles           ${ROLES.length}`);

    // ── Commission rules ─────────────────────────────────────────────────────
    for (const rule of COMMISSION_RULES) {
      if (rule.scopeType === 'PLATFORM') {
        // A partial unique index allows only one active platform default per
        // appliesTo, so find-then-write rather than blind create.
        const existing = await prisma.commissionRule.findFirst({
          where: { scopeType: 'PLATFORM', appliesTo: 'ORDER', isActive: true, effectiveTo: null },
        });
        if (existing) {
          await prisma.commissionRule.update({
            where: { id: existing.id },
            data: {
              percentBps: rule.percentBps,
              minMinor: rule.minMinor,
              description: rule.description,
            },
          });
        } else {
          await prisma.commissionRule.create({
            data: {
              scopeType: 'PLATFORM',
              appliesTo: 'ORDER',
              model: 'PERCENTAGE',
              percentBps: rule.percentBps,
              minMinor: rule.minMinor,
              currency: rule.minMinor === null ? null : 'GBP',
              description: rule.description,
            },
          });
        }
        continue;
      }

      const category = await prisma.category.findUnique({ where: { slug: rule.categorySlug! } });
      if (!category)
        throw new Error(`Seed error: category ${rule.categorySlug} missing for commission rule`);

      const existing = await prisma.commissionRule.findFirst({
        where: {
          scopeType: 'CATEGORY',
          categoryId: category.id,
          appliesTo: 'ORDER',
          isActive: true,
          effectiveTo: null,
        },
      });

      if (existing) {
        await prisma.commissionRule.update({
          where: { id: existing.id },
          data: {
            percentBps: rule.percentBps,
            minMinor: rule.minMinor,
            description: rule.description,
          },
        });
      } else {
        await prisma.commissionRule.create({
          data: {
            scopeType: 'CATEGORY',
            categoryId: category.id,
            appliesTo: 'ORDER',
            model: 'PERCENTAGE',
            percentBps: rule.percentBps,
            minMinor: rule.minMinor,
            currency: rule.minMinor === null ? null : 'GBP',
            description: rule.description,
          },
        });
      }
    }
    log(`  commission      ${COMMISSION_RULES.length} rules`);

    // ── Settings ─────────────────────────────────────────────────────────────
    for (const setting of SETTINGS) {
      // find-then-write rather than upsert: Prisma cannot pass a null into a
      // compound-unique `where`, and `scopeId` is null for GLOBAL settings.
      // The database still enforces uniqueness via a NULLS NOT DISTINCT index.
      const existing = await prisma.setting.findFirst({
        where: { key: setting.key, scope: 'GLOBAL', scopeId: null },
      });

      if (existing) {
        // Values are NOT overwritten on re-seed: an operator who changed a
        // setting in the admin panel must not have it silently reverted by a
        // deploy. Only the description is kept in step with the code.
        await prisma.setting.update({
          where: { id: existing.id },
          data: { description: setting.description, isPublic: setting.isPublic },
        });
      } else {
        await prisma.setting.create({
          data: {
            key: setting.key,
            scope: 'GLOBAL',
            value: setting.value as never,
            isPublic: setting.isPublic,
            description: setting.description,
          },
        });
      }
    }
    log(`  settings        ${SETTINGS.length}`);

    // ── Prohibited item rules ────────────────────────────────────────────────
    for (const rule of PROHIBITED_RULES) {
      const country = rule.countryCode
        ? await prisma.country.findUnique({ where: { code: rule.countryCode } })
        : null;
      const category = rule.categorySlug
        ? await prisma.category.findUnique({ where: { slug: rule.categorySlug } })
        : null;

      const existing = await prisma.prohibitedItemRule.findFirst({
        where: {
          pattern: rule.pattern,
          countryId: country?.id ?? null,
          categoryId: category?.id ?? null,
        },
      });

      if (existing) {
        await prisma.prohibitedItemRule.update({
          where: { id: existing.id },
          data: { ruleType: rule.ruleType, note: rule.note },
        });
      } else {
        await prisma.prohibitedItemRule.create({
          data: {
            pattern: rule.pattern,
            ruleType: rule.ruleType,
            note: rule.note,
            countryId: country?.id ?? null,
            categoryId: category?.id ?? null,
          },
        });
      }
    }
    log(`  prohibited      ${PROHIBITED_RULES.length} rules`);

    return {
      currencies: CURRENCIES.length,
      countries: COUNTRIES.length,
      cities: CITIES.length,
      categories: CATEGORIES.length,
      attributes: attributeCount,
      permissions: PERMISSIONS.length,
      roles: ROLES.length,
      commissionRules: COMMISSION_RULES.length,
      settings: SETTINGS.length,
      prohibitedRules: PROHIBITED_RULES.length,
    };
  } finally {
    await prisma.$disconnect();
  }
}

/** Upserts one category with its attributes and options. Returns attribute count. */
async function upsertCategory(prisma: PrismaClient, category: CategorySeed): Promise<number> {
  const parent = category.parentSlug
    ? await prisma.category.findUnique({ where: { slug: category.parentSlug } })
    : null;

  if (category.parentSlug && !parent) {
    throw new Error(
      `Seed error: parent category ${category.parentSlug} missing for ${category.slug}`,
    );
  }

  // Materialised path, delimited at both ends so a prefix scan cannot match a
  // sibling whose slug merely starts with the same characters. A CHECK
  // constraint enforces the shape.
  const path = parent ? `${parent.path}${category.slug}/` : `/${category.slug}/`;
  const depth = parent ? parent.depth + 1 : 0;

  const record = await prisma.category.upsert({
    where: { slug: category.slug },
    create: {
      slug: category.slug,
      parentId: parent?.id ?? null,
      path,
      depth,
      position: category.position,
      isActive: category.isActive,
      transactionFlow: category.transactionFlow,
      allowsOnlinePayment: category.allowsOnlinePayment,
      feePayer: category.feePayer,
      maxOnlineAmountMinor: category.maxOnlineAmountMinor,
      requiresApproval: category.requiresApproval,
      requiresVerifiedSeller: category.requiresVerifiedSeller,
      maxImages: category.maxImages,
      listingDurationDays: category.listingDurationDays,
    },
    update: {
      parentId: parent?.id ?? null,
      path,
      depth,
      position: category.position,
      transactionFlow: category.transactionFlow,
      allowsOnlinePayment: category.allowsOnlinePayment,
      feePayer: category.feePayer,
      maxOnlineAmountMinor: category.maxOnlineAmountMinor,
      requiresApproval: category.requiresApproval,
      requiresVerifiedSeller: category.requiresVerifiedSeller,
      maxImages: category.maxImages,
      listingDurationDays: category.listingDurationDays,
    },
  });

  for (const locale of LOCALES) {
    const name = category.names[locale];
    if (!name) continue;
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: record.id, locale } },
      create: { categoryId: record.id, locale, name },
      update: { name },
    });
  }

  let position = 0;
  for (const attribute of category.attributes) {
    position += 1;
    const attributeRecord = await prisma.attributeDefinition.upsert({
      where: { categoryId_key: { categoryId: record.id, key: attribute.key } },
      create: {
        categoryId: record.id,
        key: attribute.key,
        dataType: attribute.dataType,
        unit: attribute.unit ?? null,
        isRequired: attribute.isRequired,
        isFilterable: attribute.isFilterable,
        isSearchable: attribute.isSearchable ?? false,
        position,
        validation: (attribute.validation ?? {}) as never,
      },
      update: {
        dataType: attribute.dataType,
        unit: attribute.unit ?? null,
        isRequired: attribute.isRequired,
        isFilterable: attribute.isFilterable,
        isSearchable: attribute.isSearchable ?? false,
        position,
        validation: (attribute.validation ?? {}) as never,
      },
    });

    for (const locale of LOCALES) {
      const label = attribute.labels[locale];
      if (!label) continue;
      await prisma.attributeDefinitionTranslation.upsert({
        where: {
          attributeDefinitionId_locale: { attributeDefinitionId: attributeRecord.id, locale },
        },
        create: { attributeDefinitionId: attributeRecord.id, locale, label },
        update: { label },
      });
    }

    let optionPosition = 0;
    for (const option of attribute.options ?? []) {
      optionPosition += 1;
      const optionRecord = await prisma.attributeOption.upsert({
        where: {
          attributeDefinitionId_value: {
            attributeDefinitionId: attributeRecord.id,
            value: option.value,
          },
        },
        create: {
          attributeDefinitionId: attributeRecord.id,
          value: option.value,
          position: optionPosition,
        },
        update: { position: optionPosition },
      });

      for (const locale of LOCALES) {
        const label = option.labels[locale];
        if (!label) continue;
        await prisma.attributeOptionTranslation.upsert({
          where: { attributeOptionId_locale: { attributeOptionId: optionRecord.id, locale } },
          create: { attributeOptionId: optionRecord.id, locale, label },
          update: { label },
        });
      }
    }
  }

  return category.attributes.length;
}
