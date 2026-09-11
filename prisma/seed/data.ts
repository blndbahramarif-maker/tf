/**
 * Seed data definitions.
 *
 * Pure data, no database access — so it can be asserted on in tests and
 * reviewed as a spec. The launch configuration lives here:
 * UK only, four categories, GBP + EUR, English + Sorani
 * (docs/12-decisions-log.md, DL-4).
 *
 * Everything here is CONFIGURATION, not code: categories, commission rates,
 * countries and currencies are all editable in the admin panel later without
 * a deploy. These are starting values, not constants.
 */

export interface CurrencySeed {
  code: string;
  minorUnitDigits: number;
  symbol: string;
  isActive: boolean;
  position: number;
}

export const CURRENCIES: CurrencySeed[] = [
  { code: 'GBP', minorUnitDigits: 2, symbol: '£', isActive: true, position: 1 },
  { code: 'EUR', minorUnitDigits: 2, symbol: '€', isActive: true, position: 2 },
  // Defined but inactive: European expansion is a toggle, not a migration.
  { code: 'SEK', minorUnitDigits: 2, symbol: 'kr', isActive: false, position: 3 },
  { code: 'NOK', minorUnitDigits: 2, symbol: 'kr', isActive: false, position: 4 },
  { code: 'DKK', minorUnitDigits: 2, symbol: 'kr', isActive: false, position: 5 },
  { code: 'CHF', minorUnitDigits: 2, symbol: 'CHF', isActive: false, position: 6 },
  { code: 'PLN', minorUnitDigits: 2, symbol: 'zł', isActive: false, position: 7 },
];

export interface CountrySeed {
  code: string;
  defaultCurrency: string;
  isActive: boolean;
  payoutsSupported: boolean;
  phonePrefix: string;
  timezone: string;
  position: number;
  names: Record<string, string>;
}

/**
 * The UK is the only active country at launch. The rest are seeded inactive
 * so expansion is an admin toggle.
 *
 * `payoutsSupported` reflects Stripe cross-border payouts: a UK platform can
 * pay connected accounts across the UK and EEA, fee-free for UK↔EEA
 * (ADR-0007). It does NOT mean we have launched there.
 */
export const COUNTRIES: CountrySeed[] = [
  {
    code: 'GB',
    defaultCurrency: 'GBP',
    isActive: true,
    payoutsSupported: true,
    phonePrefix: '+44',
    timezone: 'Europe/London',
    position: 1,
    names: {
      en: 'United Kingdom',
      ckb: 'شانشینی یەکگرتوو',
      kmr: 'Keyaniya Yekbûyî',
      ar: 'المملكة المتحدة',
    },
  },
  {
    code: 'DE',
    defaultCurrency: 'EUR',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+49',
    timezone: 'Europe/Berlin',
    position: 2,
    names: { en: 'Germany', ckb: 'ئەڵمانیا', kmr: 'Almanya', ar: 'ألمانيا' },
  },
  {
    code: 'SE',
    defaultCurrency: 'SEK',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+46',
    timezone: 'Europe/Stockholm',
    position: 3,
    names: { en: 'Sweden', ckb: 'سوید', kmr: 'Swêd', ar: 'السويد' },
  },
  {
    code: 'NL',
    defaultCurrency: 'EUR',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+31',
    timezone: 'Europe/Amsterdam',
    position: 4,
    names: { en: 'Netherlands', ckb: 'هۆڵەندا', kmr: 'Holenda', ar: 'هولندا' },
  },
  {
    code: 'FR',
    defaultCurrency: 'EUR',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+33',
    timezone: 'Europe/Paris',
    position: 5,
    names: { en: 'France', ckb: 'فەڕەنسا', kmr: 'Fransa', ar: 'فرنسا' },
  },
  {
    code: 'BE',
    defaultCurrency: 'EUR',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+32',
    timezone: 'Europe/Brussels',
    position: 6,
    names: { en: 'Belgium', ckb: 'بەلژیکا', kmr: 'Belçîka', ar: 'بلجيكا' },
  },
  {
    code: 'AT',
    defaultCurrency: 'EUR',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+43',
    timezone: 'Europe/Vienna',
    position: 7,
    names: { en: 'Austria', ckb: 'نەمسا', kmr: 'Awisturya', ar: 'النمسا' },
  },
  {
    code: 'DK',
    defaultCurrency: 'DKK',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+45',
    timezone: 'Europe/Copenhagen',
    position: 8,
    names: { en: 'Denmark', ckb: 'دانمارک', kmr: 'Danîmarka', ar: 'الدنمارك' },
  },
  {
    code: 'NO',
    defaultCurrency: 'NOK',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+47',
    timezone: 'Europe/Oslo',
    position: 9,
    names: { en: 'Norway', ckb: 'نەرویج', kmr: 'Norwêc', ar: 'النرويج' },
  },
  {
    code: 'CH',
    defaultCurrency: 'CHF',
    isActive: false,
    payoutsSupported: true,
    phonePrefix: '+41',
    timezone: 'Europe/Zurich',
    position: 10,
    names: { en: 'Switzerland', ckb: 'سویسرا', kmr: 'Swîsre', ar: 'سويسرا' },
  },
];

export interface CitySeed {
  countryCode: string;
  name: string;
  slug: string;
  population: number;
}

/** UK cities with established Kurdish communities, plus national coverage. */
export const CITIES: CitySeed[] = [
  { countryCode: 'GB', name: 'London', slug: 'london', population: 8982000 },
  { countryCode: 'GB', name: 'Birmingham', slug: 'birmingham', population: 1141000 },
  { countryCode: 'GB', name: 'Manchester', slug: 'manchester', population: 553000 },
  { countryCode: 'GB', name: 'Leeds', slug: 'leeds', population: 789000 },
  { countryCode: 'GB', name: 'Sheffield', slug: 'sheffield', population: 584000 },
  { countryCode: 'GB', name: 'Glasgow', slug: 'glasgow', population: 635000 },
  { countryCode: 'GB', name: 'Liverpool', slug: 'liverpool', population: 498000 },
  { countryCode: 'GB', name: 'Bristol', slug: 'bristol', population: 467000 },
  {
    countryCode: 'GB',
    name: 'Newcastle upon Tyne',
    slug: 'newcastle-upon-tyne',
    population: 300000,
  },
  { countryCode: 'GB', name: 'Cardiff', slug: 'cardiff', population: 366000 },
  { countryCode: 'GB', name: 'Edinburgh', slug: 'edinburgh', population: 524000 },
  { countryCode: 'GB', name: 'Nottingham', slug: 'nottingham', population: 323000 },
  { countryCode: 'GB', name: 'Coventry', slug: 'coventry', population: 371000 },
  { countryCode: 'GB', name: 'Leicester', slug: 'leicester', population: 355000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Categories — the four launch categories (DL-4)
// ─────────────────────────────────────────────────────────────────────────────

export interface AttributeOptionSeed {
  value: string;
  labels: Record<string, string>;
}

export interface AttributeSeed {
  key: string;
  dataType: 'TEXT' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM' | 'DATE';
  unit?: string;
  isRequired: boolean;
  isFilterable: boolean;
  isSearchable?: boolean;
  validation?: Record<string, unknown>;
  labels: Record<string, string>;
  options?: AttributeOptionSeed[];
}

export interface CategorySeed {
  slug: string;
  parentSlug: string | null;
  position: number;
  isActive: boolean;
  transactionFlow: 'BUY_NOW' | 'OFFER_THEN_PAY' | 'FEE_ONLY' | 'CONTACT_ONLY';
  allowsOnlinePayment: boolean;
  feePayer: 'BUYER' | 'SELLER' | 'SPLIT';
  maxOnlineAmountMinor: bigint | null;
  requiresApproval: boolean;
  requiresVerifiedSeller: boolean;
  maxImages: number;
  listingDurationDays: number;
  /** Basis points. Seeded values; fully editable in the admin panel. */
  commissionBps: number;
  names: Record<string, string>;
  attributes: AttributeSeed[];
}

/**
 * Launch categories.
 *
 * Note the two commission regimes (docs/12-decisions-log.md, DL-2):
 *
 *   Cars & Business → FEE_ONLY at 50 bps (0.5%). The purchase principal never
 *     passes through Stripe, so 0.5% is profitable: a £50,000 sale yields £250
 *     for roughly £4 of processing cost.
 *
 *   Mobile & Electronics, Kurdish Clothing → BUY_NOW at 600–700 bps (6–7%).
 *     0.5% would LOSE money here: a £200 phone earns £1.00 against a £3.20 card
 *     fee. The rate must exceed the processing cost when we are the merchant
 *     of record.
 */
export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'cars',
    parentSlug: null,
    position: 1,
    isActive: true,
    transactionFlow: 'FEE_ONLY',
    allowsOnlinePayment: true,
    feePayer: 'BUYER',
    // Only the fee is charged online, never the vehicle price. A hard ceiling
    // so a misconfiguration cannot put a £50,000 charge through this flow.
    maxOnlineAmountMinor: 500_000n, // £5,000.00
    requiresApproval: true,
    requiresVerifiedSeller: true,
    maxImages: 20,
    listingDurationDays: 60,
    commissionBps: 50,
    names: { en: 'Cars', ckb: 'ئۆتۆمبێل', kmr: 'Otomobîl', ar: 'سيارات' },
    attributes: [
      {
        key: 'make',
        dataType: 'TEXT',
        isRequired: true,
        isFilterable: true,
        isSearchable: true,
        labels: { en: 'Make', ckb: 'کۆمپانیا', kmr: 'Marqe', ar: 'الصانع' },
      },
      {
        key: 'model',
        dataType: 'TEXT',
        isRequired: true,
        isFilterable: true,
        isSearchable: true,
        labels: { en: 'Model', ckb: 'مۆدێل', kmr: 'Model', ar: 'الطراز' },
      },
      {
        key: 'year',
        dataType: 'INTEGER',
        isRequired: true,
        isFilterable: true,
        validation: { min: 1900, max: 2100 },
        labels: { en: 'Year', ckb: 'ساڵ', kmr: 'Sal', ar: 'السنة' },
      },
      {
        key: 'mileage',
        dataType: 'INTEGER',
        unit: 'mi',
        isRequired: true,
        isFilterable: true,
        validation: { min: 0, max: 1000000 },
        labels: { en: 'Mileage', ckb: 'مایل', kmr: 'Mesafe', ar: 'المسافة المقطوعة' },
      },
      {
        key: 'fuel_type',
        dataType: 'ENUM',
        isRequired: true,
        isFilterable: true,
        labels: {
          en: 'Fuel type',
          ckb: 'جۆری سووتەمەنی',
          kmr: 'Cureyê sotemeniyê',
          ar: 'نوع الوقود',
        },
        options: [
          { value: 'petrol', labels: { en: 'Petrol', ckb: 'بەنزین', kmr: 'Benzîn', ar: 'بنزين' } },
          { value: 'diesel', labels: { en: 'Diesel', ckb: 'دیزڵ', kmr: 'Mazot', ar: 'ديزل' } },
          { value: 'hybrid', labels: { en: 'Hybrid', ckb: 'هایبرید', kmr: 'Hîbrîd', ar: 'هجين' } },
          {
            value: 'electric',
            labels: { en: 'Electric', ckb: 'کارەبایی', kmr: 'Elektrîk', ar: 'كهربائي' },
          },
        ],
      },
      {
        key: 'transmission',
        dataType: 'ENUM',
        isRequired: true,
        isFilterable: true,
        labels: { en: 'Transmission', ckb: 'گێڕ', kmr: 'Vîtês', ar: 'ناقل الحركة' },
        options: [
          { value: 'manual', labels: { en: 'Manual', ckb: 'دەستی', kmr: 'Destî', ar: 'يدوي' } },
          {
            value: 'automatic',
            labels: { en: 'Automatic', ckb: 'ئۆتۆماتیک', kmr: 'Otomatîk', ar: 'أوتوماتيكي' },
          },
        ],
      },
      {
        key: 'engine_size_cc',
        dataType: 'INTEGER',
        unit: 'cc',
        isRequired: false,
        isFilterable: true,
        validation: { min: 0, max: 10000 },
        labels: {
          en: 'Engine size',
          ckb: 'قەبارەی بزوێنەر',
          kmr: 'Mezinahiya motorê',
          ar: 'سعة المحرك',
        },
      },
      {
        key: 'mot_expiry',
        dataType: 'DATE',
        isRequired: false,
        isFilterable: false,
        labels: {
          en: 'MOT expiry',
          ckb: 'بەسەرچوونی MOT',
          kmr: 'Dawiya MOT',
          ar: 'انتهاء الفحص الفني',
        },
      },
    ],
  },
  {
    slug: 'mobile-electronics',
    parentSlug: null,
    position: 2,
    isActive: true,
    transactionFlow: 'BUY_NOW',
    allowsOnlinePayment: true,
    feePayer: 'BUYER',
    maxOnlineAmountMinor: 500_000n, // £5,000.00
    requiresApproval: false,
    requiresVerifiedSeller: false,
    maxImages: 12,
    listingDurationDays: 30,
    commissionBps: 600,
    names: {
      en: 'Mobile & Electronics',
      ckb: 'مۆبایل و ئەلیکترۆنیات',
      kmr: 'Mobîl û Elektronîk',
      ar: 'الهواتف والإلكترونيات',
    },
    attributes: [
      {
        key: 'brand',
        dataType: 'TEXT',
        isRequired: true,
        isFilterable: true,
        isSearchable: true,
        labels: { en: 'Brand', ckb: 'براند', kmr: 'Marqe', ar: 'العلامة التجارية' },
      },
      {
        key: 'model',
        dataType: 'TEXT',
        isRequired: true,
        isFilterable: true,
        isSearchable: true,
        labels: { en: 'Model', ckb: 'مۆدێل', kmr: 'Model', ar: 'الطراز' },
      },
      {
        key: 'storage_gb',
        dataType: 'INTEGER',
        unit: 'GB',
        isRequired: false,
        isFilterable: true,
        validation: { min: 1, max: 8192 },
        labels: { en: 'Storage', ckb: 'بیرگە', kmr: 'Bîrgeh', ar: 'سعة التخزين' },
      },
      {
        key: 'warranty_months',
        dataType: 'INTEGER',
        unit: 'months',
        isRequired: false,
        isFilterable: true,
        validation: { min: 0, max: 120 },
        labels: {
          en: 'Warranty remaining',
          ckb: 'گەرەنتی ماوە',
          kmr: 'Garantiya mayî',
          ar: 'الضمان المتبقي',
        },
      },
      {
        key: 'unlocked',
        dataType: 'BOOLEAN',
        isRequired: false,
        isFilterable: true,
        labels: { en: 'Unlocked', ckb: 'کراوەیە', kmr: 'Vekirî', ar: 'غير مقفل' },
      },
    ],
  },
  {
    slug: 'kurdish-clothing',
    parentSlug: null,
    position: 3,
    isActive: true,
    transactionFlow: 'BUY_NOW',
    allowsOnlinePayment: true,
    feePayer: 'BUYER',
    maxOnlineAmountMinor: 200_000n, // £2,000.00
    requiresApproval: false,
    requiresVerifiedSeller: false,
    maxImages: 12,
    listingDurationDays: 45,
    commissionBps: 700,
    names: {
      en: 'Kurdish Clothing',
      ckb: 'جل و بەرگی کوردی',
      kmr: 'Cil û bergên kurdî',
      ar: 'الأزياء الكردية',
    },
    attributes: [
      {
        key: 'garment_type',
        dataType: 'ENUM',
        isRequired: true,
        isFilterable: true,
        labels: { en: 'Garment type', ckb: 'جۆری جل', kmr: 'Cureyê cilê', ar: 'نوع الملبس' },
        options: [
          {
            value: 'kras_u_rank',
            labels: {
              en: 'Kras û Rank',
              ckb: 'کراس و ڕانک',
              kmr: 'Kiras û Rank',
              ar: 'كراس ورانك',
            },
          },
          {
            value: 'shal_u_shapik',
            labels: { en: 'Shal û Shapik', ckb: 'شاڵ و شاپک', kmr: 'Şal û Şapik', ar: 'شال وشابك' },
          },
          { value: 'kawa', labels: { en: 'Kawa', ckb: 'کەوا', kmr: 'Kewa', ar: 'كوا' } },
          {
            value: 'jli_kurdi',
            labels: {
              en: 'Jli Kurdi (dress)',
              ckb: 'جلی کوردی',
              kmr: 'Cilê kurdî',
              ar: 'فستان كردي',
            },
          },
          {
            value: 'accessory',
            labels: { en: 'Accessory', ckb: 'ئێکسسوار', kmr: 'Aksesuar', ar: 'إكسسوار' },
          },
        ],
      },
      {
        key: 'size',
        dataType: 'TEXT',
        isRequired: false,
        isFilterable: true,
        labels: { en: 'Size', ckb: 'قەبارە', kmr: 'Mezinahî', ar: 'المقاس' },
      },
      {
        key: 'handmade',
        dataType: 'BOOLEAN',
        isRequired: false,
        isFilterable: true,
        labels: { en: 'Handmade', ckb: 'دەستکرد', kmr: 'Bi dest çêkirî', ar: 'مصنوع يدوياً' },
      },
      {
        key: 'region',
        dataType: 'TEXT',
        isRequired: false,
        isFilterable: true,
        isSearchable: true,
        labels: {
          en: 'Regional style',
          ckb: 'شێوازی هەرێمی',
          kmr: 'Şêwaza herêmî',
          ar: 'الطراز الإقليمي',
        },
      },
    ],
  },
  {
    slug: 'business',
    parentSlug: null,
    position: 4,
    isActive: true,
    transactionFlow: 'FEE_ONLY',
    allowsOnlinePayment: true,
    feePayer: 'BUYER',
    maxOnlineAmountMinor: 1_000_000n, // £10,000.00 fee ceiling
    requiresApproval: true,
    requiresVerifiedSeller: true,
    maxImages: 20,
    listingDurationDays: 90,
    commissionBps: 50,
    names: { en: 'Business', ckb: 'بزنس', kmr: 'Karsazî', ar: 'أعمال تجارية' },
    attributes: [
      {
        key: 'business_type',
        dataType: 'ENUM',
        isRequired: true,
        isFilterable: true,
        labels: {
          en: 'Business type',
          ckb: 'جۆری بزنس',
          kmr: 'Cureyê karsaziyê',
          ar: 'نوع النشاط',
        },
        options: [
          {
            value: 'restaurant',
            labels: { en: 'Restaurant / Takeaway', ckb: 'چێشتخانە', kmr: 'Xwaringeh', ar: 'مطعم' },
          },
          {
            value: 'retail',
            labels: { en: 'Retail shop', ckb: 'دوکان', kmr: 'Dikan', ar: 'متجر' },
          },
          {
            value: 'salon',
            labels: { en: 'Salon / Barber', ckb: 'سالۆن', kmr: 'Salon', ar: 'صالون' },
          },
          {
            value: 'wholesale',
            labels: { en: 'Wholesale', ckb: 'کۆگا', kmr: 'Firotana bi kom', ar: 'بيع بالجملة' },
          },
          {
            value: 'services',
            labels: { en: 'Services', ckb: 'خزمەتگوزاری', kmr: 'Xizmet', ar: 'خدمات' },
          },
          { value: 'other', labels: { en: 'Other', ckb: 'هیتر', kmr: 'Yên din', ar: 'أخرى' } },
        ],
      },
      {
        key: 'asking_price_minor',
        dataType: 'INTEGER',
        isRequired: true,
        isFilterable: true,
        validation: { min: 0 },
        labels: {
          en: 'Asking price',
          ckb: 'نرخی داواکراو',
          kmr: 'Bihayê xwestî',
          ar: 'السعر المطلوب',
        },
      },
      {
        key: 'annual_revenue_minor',
        dataType: 'INTEGER',
        isRequired: false,
        isFilterable: true,
        validation: { min: 0 },
        labels: {
          en: 'Annual revenue',
          ckb: 'داهاتی ساڵانە',
          kmr: 'Dahatiya salane',
          ar: 'الإيرادات السنوية',
        },
      },
      {
        key: 'years_established',
        dataType: 'INTEGER',
        unit: 'years',
        isRequired: false,
        isFilterable: true,
        validation: { min: 0, max: 200 },
        labels: {
          en: 'Years established',
          ckb: 'ساڵانی دامەزراندن',
          kmr: 'Salên damezrandinê',
          ar: 'سنوات التأسيس',
        },
      },
      {
        key: 'employees',
        dataType: 'INTEGER',
        isRequired: false,
        isFilterable: true,
        validation: { min: 0, max: 100000 },
        labels: { en: 'Employees', ckb: 'کارمەندان', kmr: 'Karmend', ar: 'عدد الموظفين' },
      },
      {
        key: 'reason_for_sale',
        dataType: 'TEXT',
        isRequired: false,
        isFilterable: false,
        labels: {
          en: 'Reason for sale',
          ckb: 'هۆکاری فرۆشتن',
          kmr: 'Sedema firotinê',
          ar: 'سبب البيع',
        },
      },
      {
        key: 'leasehold',
        dataType: 'BOOLEAN',
        isRequired: false,
        isFilterable: true,
        labels: { en: 'Leasehold', ckb: 'بەکرێ', kmr: 'Bi kirê', ar: 'إيجار' },
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionSeed {
  key: string;
  category: string;
  description: string;
}

export const PERMISSIONS: PermissionSeed[] = [
  // Self-service. Held by EVERY role, staff included: using a business
  // permission such as `order:read_own` as a proxy for "is authenticated"
  // would deny a moderator access to their own profile.
  {
    key: 'account:read_self',
    category: 'account',
    description: 'View own account and sessions',
  },
  { key: 'account:update_self', category: 'account', description: 'Update own profile' },
  {
    key: 'account:manage_security',
    category: 'account',
    description: 'Change password, manage two-factor, revoke own sessions',
  },
  // Selling
  { key: 'seller:create_profile', category: 'selling', description: 'Create a seller profile' },
  {
    key: 'seller:update_own_profile',
    category: 'selling',
    description: 'Edit own seller profile',
  },
  // Listings
  { key: 'listing:create', category: 'listing', description: 'Create a listing' },
  { key: 'listing:update_own', category: 'listing', description: 'Edit own listings' },
  { key: 'listing:delete_own', category: 'listing', description: 'Delete own listings' },
  { key: 'listing:publish', category: 'listing', description: 'Publish a listing' },
  { key: 'listing:moderate', category: 'listing', description: 'Hide or remove any listing' },
  { key: 'listing:approve', category: 'listing', description: 'Approve listings awaiting review' },
  { key: 'listing:feature', category: 'listing', description: 'Promote a listing' },
  // Catalogue
  {
    key: 'category:manage',
    category: 'catalogue',
    description: 'Create, edit and reorder categories',
  },
  {
    key: 'category:set_commission',
    category: 'catalogue',
    description: 'Set category commission rates',
  },
  { key: 'geo:manage', category: 'catalogue', description: 'Manage countries and cities' },
  // Orders and money
  { key: 'order:read_own', category: 'commerce', description: 'View own orders' },
  { key: 'order:read_any', category: 'commerce', description: 'View any order' },
  { key: 'order:cancel', category: 'commerce', description: 'Cancel an order' },
  { key: 'payment:read_any', category: 'commerce', description: 'View any payment' },
  { key: 'refund:issue', category: 'commerce', description: 'Issue a refund' },
  { key: 'payout:read_own', category: 'commerce', description: 'View own payouts' },
  { key: 'payout:read_any', category: 'commerce', description: 'View any payout' },
  { key: 'payout:release', category: 'commerce', description: 'Release a held payout' },
  { key: 'payout:hold', category: 'commerce', description: 'Hold a payout' },
  {
    key: 'commission:manage',
    category: 'commerce',
    description: 'Create and edit commission rules',
  },
  { key: 'dispute:manage', category: 'commerce', description: 'Respond to disputes' },
  // Selling
  {
    key: 'seller:verify',
    category: 'selling',
    description: 'Approve or reject seller verification',
  },
  { key: 'seller:suspend', category: 'selling', description: 'Suspend a seller' },
  // Trust and safety
  { key: 'message:read_reported', category: 'trust', description: 'Read reported conversations' },
  { key: 'review:moderate', category: 'trust', description: 'Hide or remove reviews' },
  { key: 'report:triage', category: 'trust', description: 'Triage and resolve reports' },
  { key: 'user:suspend', category: 'trust', description: 'Suspend a user' },
  { key: 'user:ban', category: 'trust', description: 'Permanently ban a user' },
  // Platform
  { key: 'user:read', category: 'platform', description: 'View user records' },
  { key: 'user:export_data', category: 'platform', description: 'Export a user’s data (GDPR)' },
  { key: 'user:delete_data', category: 'platform', description: 'Erase a user’s data (GDPR)' },
  { key: 'setting:update', category: 'platform', description: 'Change platform settings' },
  { key: 'translation:update', category: 'platform', description: 'Edit translations' },
  { key: 'analytics:read_basic', category: 'platform', description: 'View basic analytics' },
  {
    key: 'analytics:read_financial',
    category: 'platform',
    description: 'View financial analytics',
  },
  { key: 'audit:read', category: 'platform', description: 'Read the audit log' },
  { key: 'role:assign', category: 'platform', description: 'Assign roles to users' },
];

export interface RoleSeed {
  key: string;
  description: string;
  permissions: string[] | '*';
  /**
   * Holders must have TOTP enrolled before the role grants anything. Stored as
   * a column rather than a hard-coded list of role names, so the owner can
   * require two-factor for a new role without a deploy.
   */
  requiresTwoFactor: boolean;
}

/**
 * Moderation and finance are deliberately separate.
 *
 * Whoever can hide a listing must not also be able to issue a £50,000 refund.
 * That separation is worth more than the convenience of one "staff" role.
 */
export const ROLES: RoleSeed[] = [
  {
    key: 'buyer',
    description: 'Registered buyer',
    requiresTwoFactor: false,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'seller:create_profile',
      'order:read_own',
    ],
  },
  {
    key: 'seller',
    description: 'Individual seller',
    requiresTwoFactor: false,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'seller:create_profile',
      'seller:update_own_profile',
      'listing:create',
      'listing:update_own',
      'listing:delete_own',
      'listing:publish',
      'order:read_own',
      'payout:read_own',
    ],
  },
  {
    key: 'business_seller',
    description: 'Verified business seller',
    requiresTwoFactor: false,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'seller:create_profile',
      'seller:update_own_profile',
      'listing:create',
      'listing:update_own',
      'listing:delete_own',
      'listing:publish',
      'order:read_own',
      'payout:read_own',
      'analytics:read_basic',
    ],
  },
  {
    key: 'moderator',
    description: 'Trust and safety. No financial permissions.',
    requiresTwoFactor: true,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'listing:moderate',
      'listing:approve',
      'message:read_reported',
      'review:moderate',
      'report:triage',
      'user:suspend',
      'user:read',
    ],
  },
  {
    key: 'support',
    description: 'Customer support. Read-only on money.',
    requiresTwoFactor: true,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'user:read',
      'order:read_any',
      'payment:read_any',
      'payout:read_any',
      'report:triage',
    ],
  },
  {
    key: 'finance',
    description: 'Finance. No content moderation.',
    requiresTwoFactor: true,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'order:read_any',
      'payment:read_any',
      'refund:issue',
      'payout:read_any',
      'payout:release',
      'payout:hold',
      'commission:manage',
      'dispute:manage',
      'analytics:read_basic',
      'analytics:read_financial',
    ],
  },
  {
    key: 'admin',
    description: 'Platform administrator',
    requiresTwoFactor: true,
    permissions: [
      'account:read_self',
      'account:update_self',
      'account:manage_security',
      'listing:moderate',
      'listing:approve',
      'listing:feature',
      'category:manage',
      'category:set_commission',
      'geo:manage',
      'order:read_any',
      'payment:read_any',
      'payout:read_any',
      'seller:verify',
      'seller:suspend',
      'message:read_reported',
      'review:moderate',
      'report:triage',
      'user:read',
      'user:suspend',
      'user:ban',
      'setting:update',
      'translation:update',
      'analytics:read_basic',
      'audit:read',
    ],
  },
  {
    key: 'super_admin',
    description: 'Platform owner. All permissions, including role assignment.',
    requiresTwoFactor: true,
    permissions: '*',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Platform settings and commission defaults
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingSeed {
  key: string;
  value: unknown;
  isPublic: boolean;
  description: string;
}

export const SETTINGS: SettingSeed[] = [
  {
    key: 'platform.base_currency',
    value: 'GBP',
    isPublic: false,
    description: 'Currency all analytics are reported in',
  },
  { key: 'platform.default_locale', value: 'en', isPublic: true, description: 'Fallback locale' },
  {
    key: 'platform.enabled_locales',
    value: ['en', 'ckb'],
    isPublic: true,
    description: 'Locales users may select',
  },
  {
    key: 'listing.default_duration_days',
    value: 30,
    isPublic: false,
    description: 'Used when a category sets none',
  },
  {
    key: 'order.payment_window_minutes',
    value: 30,
    isPublic: false,
    description: 'How long a pending order holds a listing',
  },
  {
    key: 'offer.default_expiry_hours',
    value: 48,
    isPublic: false,
    description: 'Default offer lifetime',
  },
  {
    key: 'offer.payment_deadline_hours',
    value: 48,
    isPublic: false,
    description: 'Time to pay after an offer is accepted',
  },
  {
    key: 'review.window_days',
    value: 30,
    isPublic: false,
    description: 'How long after completion a review may be left',
  },
  {
    key: 'payout.default_delay_days',
    value: 7,
    isPublic: false,
    description: 'Buyer-protection hold before payout',
  },
  {
    key: 'moderation.message_risk_threshold',
    value: 70,
    isPublic: false,
    description: 'Score at which a conversation is queued for review',
  },
  {
    key: 'commission.minimum_minor',
    value: '50',
    isPublic: false,
    description: 'Floor so the fixed card fee cannot eat small orders (50p)',
  },
  {
    key: 'stripe.platform_approved',
    value: false,
    isPublic: false,
    description:
      'Stripe has NOT approved the business model. Written confirmation is a prerequisite for Phase 7 (docs/13-dependencies-and-blockers.md, D-A). Must never be set true without it.',
  },
];

export interface CommissionRuleSeed {
  scopeType: 'PLATFORM' | 'CATEGORY';
  categorySlug?: string;
  percentBps: number;
  minMinor: bigint | null;
  description: string;
}

/**
 * Seeded commission rules. All editable in the admin panel without a deploy —
 * these are starting values, not constants (docs/07-commission-engine.md).
 */
export const COMMISSION_RULES: CommissionRuleSeed[] = [
  {
    scopeType: 'PLATFORM',
    percentBps: 600,
    minMinor: 50n,
    description: 'Platform default, 6%. Applies where no category rule matches.',
  },
  {
    scopeType: 'CATEGORY',
    categorySlug: 'cars',
    percentBps: 50,
    minMinor: null,
    description: 'Cars 0.5% — fee-only flow, so the principal never passes through Stripe.',
  },
  {
    scopeType: 'CATEGORY',
    categorySlug: 'business',
    percentBps: 50,
    minMinor: null,
    description: 'Business 0.5% — fee-only flow.',
  },
  {
    scopeType: 'CATEGORY',
    categorySlug: 'mobile-electronics',
    percentBps: 600,
    minMinor: 50n,
    description: 'Mobile & Electronics 6% — must cover card fees where we are merchant of record.',
  },
  {
    scopeType: 'CATEGORY',
    categorySlug: 'kurdish-clothing',
    percentBps: 700,
    minMinor: 50n,
    description:
      'Kurdish Clothing 7% — low ticket values, so the fixed 20p is proportionally large.',
  },
];

/**
 * Prohibited item rules.
 *
 * Deliberately seeded per country rather than globally: what is legal in one
 * European state is illegal in another, so a single global list would be wrong
 * from the first day of expansion (docs/11-risks-and-decisions.md, R-8).
 * `FLAG` queues for human review; it does not auto-remove.
 */
export interface ProhibitedRuleSeed {
  countryCode: string | null;
  categorySlug: string | null;
  ruleType: 'BLOCK' | 'FLAG' | 'REQUIRE_APPROVAL';
  pattern: string;
  note: string;
}

export const PROHIBITED_RULES: ProhibitedRuleSeed[] = [
  {
    countryCode: null,
    categorySlug: null,
    ruleType: 'BLOCK',
    pattern: 'counterfeit',
    note: 'Counterfeit goods are prohibited by Stripe and by law',
  },
  {
    countryCode: null,
    categorySlug: null,
    ruleType: 'BLOCK',
    pattern: 'replica watch',
    note: 'Counterfeit goods',
  },
  {
    countryCode: null,
    categorySlug: null,
    ruleType: 'BLOCK',
    pattern: 'stolen',
    note: 'Stolen goods',
  },
  {
    countryCode: null,
    categorySlug: null,
    ruleType: 'FLAG',
    pattern: 'unlocked imei',
    note: 'Possible stolen handset — review',
  },
  {
    countryCode: 'GB',
    categorySlug: null,
    ruleType: 'BLOCK',
    pattern: 'pepper spray',
    note: 'Prohibited weapon in the UK',
  },
  {
    countryCode: 'GB',
    categorySlug: null,
    ruleType: 'BLOCK',
    pattern: 'stun gun',
    note: 'Prohibited weapon in the UK',
  },
  {
    countryCode: 'GB',
    categorySlug: null,
    ruleType: 'REQUIRE_APPROVAL',
    pattern: 'knife',
    note: 'Age-restricted and partly prohibited in the UK',
  },
  {
    countryCode: 'GB',
    categorySlug: 'cars',
    ruleType: 'FLAG',
    pattern: 'cat n',
    note: 'Write-off category must be disclosed',
  },
  {
    countryCode: 'GB',
    categorySlug: 'cars',
    ruleType: 'FLAG',
    pattern: 'cat s',
    note: 'Write-off category must be disclosed',
  },
  {
    countryCode: 'GB',
    categorySlug: 'cars',
    ruleType: 'FLAG',
    pattern: 'no mot',
    note: 'Roadworthiness must be disclosed',
  },
];
