/**
 * Brand configuration.
 *
 * "Kurdora" is a working name. Every user-visible reference to the brand must
 * resolve through this module or through an i18n message that interpolates
 * `{brandName}`. The literal string must not appear in components or in message
 * catalogue values, so renaming the platform is a config edit plus an asset
 * swap rather than a refactor. Enforced by tests/brand.test.ts.
 *
 * See docs/09-i18n-rtl.md ("Brand abstraction").
 */

export interface BrandConfig {
  /** Short product name used in UI copy and titles. */
  readonly name: string;
  /** Registered legal entity. Used in invoices, terms and statutory footers. */
  readonly legalEntity: {
    readonly name: string;
    readonly jurisdiction: string;
    /** Companies House number. Empty until incorporation completes. */
    readonly companyNumber: string;
    readonly vatNumber: string;
  };
  readonly domains: {
    readonly primary: string;
    readonly cdn: string;
  };
  readonly support: {
    readonly email: string;
    readonly abuseEmail: string;
    readonly privacyEmail: string;
  };
  readonly assets: {
    readonly logo: string;
    readonly logoMark: string;
    readonly ogImage: string;
  };
  /**
   * Statement descriptor shown on the buyer's card statement.
   * Stripe limits this to 22 characters for the full descriptor.
   */
  readonly statementDescriptor: string;
}

export const brand: BrandConfig = {
  name: 'Kurdora',
  legalEntity: {
    name: 'Kurdora Ltd',
    jurisdiction: 'England and Wales',
    companyNumber: '',
    vatNumber: '',
  },
  domains: {
    primary: 'kurdora.com',
    cdn: 'cdn.kurdora.com',
  },
  support: {
    email: 'support@kurdora.com',
    abuseEmail: 'abuse@kurdora.com',
    privacyEmail: 'privacy@kurdora.com',
  },
  assets: {
    logo: '/brand/logo.svg',
    logoMark: '/brand/mark.svg',
    ogImage: '/brand/og.png',
  },
  statementDescriptor: 'KURDORA',
};
