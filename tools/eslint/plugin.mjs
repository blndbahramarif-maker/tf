/**
 * Kurdora local ESLint rules.
 *
 * These encode two architectural guarantees from docs/ that are easy to break
 * accidentally and expensive to discover late:
 *
 *  1. no-physical-direction-classes — RTL correctness (docs/09-i18n-rtl.md).
 *     Sorani and Arabic are right-to-left. A single `ml-4` reaching production
 *     silently breaks layout for those users, and nobody testing in English
 *     will ever see it.
 *
 *  2. no-public-env-secrets — secret leakage (docs/08-security-architecture.md).
 *     Anything on `process.env.NEXT_PUBLIC_*` is inlined into the browser
 *     bundle. A secret there is public forever, including in git history and
 *     any CDN cache.
 */

/** Physical → logical class replacements. */
const PHYSICAL_CLASS_REPLACEMENTS = {
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
  left: 'start',
  right: 'end',
  'border-l': 'border-s',
  'border-r': 'border-e',
  'rounded-l': 'rounded-s',
  'rounded-r': 'rounded-e',
  'rounded-tl': 'rounded-ss',
  'rounded-tr': 'rounded-se',
  'rounded-bl': 'rounded-es',
  'rounded-br': 'rounded-ee',
  'text-left': 'text-start',
  'text-right': 'text-end',
  'float-left': 'float-start',
  'float-right': 'float-end',
  'origin-left': 'origin-start',
  'origin-right': 'origin-end',
};

// Matches an optional chain of variants (sm:, hover:, dark:, rtl:, group-hover:)
// then an optional `-` negation, then the utility itself.
const CLASS_TOKEN = /^((?:[a-z0-9_-]+:)*)(-?)([a-z-]+?)(-\[.*\]|-[a-z0-9./%]+)?$/i;

function checkClassString(context, node, raw) {
  for (const token of raw.split(/\s+/)) {
    if (!token) continue;

    // A template literal splits `ml-${size}` into the quasi "ml-". Strip the
    // dangling separator so interpolated classes are still checked — this is a
    // common way a physical class sneaks past a naive matcher.
    const normalised = token.replace(/-+$/, '');
    if (!normalised) continue;

    const match = CLASS_TOKEN.exec(normalised);
    if (!match) continue;
    const [, variants = '', negation = '', base = ''] = match;

    // `text-left` / `float-right` style utilities have no value suffix, so the
    // regex swallows the whole thing into `base`. Check both shapes.
    const candidates = [base, `${base}${match[4] ?? ''}`];
    for (const candidate of candidates) {
      const replacement = PHYSICAL_CLASS_REPLACEMENTS[candidate];
      if (!replacement) continue;
      context.report({
        node,
        messageId: 'physical',
        data: {
          token,
          suggestion: `${variants}${negation}${replacement}${candidate === base ? (match[4] ?? '') : ''}`,
        },
      });
      return;
    }
  }
}

/** Walks string literals inside className={...} expressions, cn(), clsx(). */
function collectStrings(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push([node, node.value]);
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) out.push([quasi, quasi.value.raw]);
      for (const expr of node.expressions) collectStrings(expr, out);
      break;
    case 'ConditionalExpression':
      collectStrings(node.consequent, out);
      collectStrings(node.alternate, out);
      break;
    case 'LogicalExpression':
      collectStrings(node.left, out);
      collectStrings(node.right, out);
      break;
    case 'ArrayExpression':
      for (const el of node.elements) collectStrings(el, out);
      break;
    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop.type === 'Property') collectStrings(prop.key, out);
      }
      break;
    case 'CallExpression':
      for (const arg of node.arguments) collectStrings(arg, out);
      break;
    case 'JSXExpressionContainer':
      collectStrings(node.expression, out);
      break;
    default:
      break;
  }
}

const noPhysicalDirectionClasses = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow physical-direction Tailwind classes; use logical properties so RTL locales (ckb, ar) render correctly.',
    },
    schema: [],
    messages: {
      physical:
        'RTL: "{{token}}" is a physical-direction class and breaks right-to-left layouts. Use "{{suggestion}}" instead. See docs/09-i18n-rtl.md.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const name = node.name?.name;
        if (name !== 'className' && name !== 'class') return;
        const strings = [];
        collectStrings(node.value, strings);
        for (const [target, raw] of strings) checkClassString(context, target, raw);
      },
    };
  },
};

/** Publishable-by-design values that legitimately contain a banned word. */
const PUBLIC_ENV_ALLOWLIST = new Set([
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
]);

const SENSITIVE_NAME = /SECRET|PRIVATE|PASSWORD|CREDENTIAL|_KEY$|_TOKEN$|APIKEY|API_KEY/i;

const noPublicEnvSecrets = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow secret-looking values on NEXT_PUBLIC_* env vars, which are inlined into the browser bundle.',
    },
    schema: [],
    messages: {
      secret:
        'SECURITY: "{{name}}" is a NEXT_PUBLIC_* variable, so its value ships to the browser. Secrets must be read server-side only. See docs/08-security-architecture.md.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const isProcessEnv =
          node.object?.type === 'MemberExpression' &&
          node.object.object?.name === 'process' &&
          node.object.property?.name === 'env';
        if (!isProcessEnv) return;

        const name = node.property?.name ?? node.property?.value;
        if (typeof name !== 'string') return;
        if (!name.startsWith('NEXT_PUBLIC_')) return;
        if (PUBLIC_ENV_ALLOWLIST.has(name)) return;
        if (!SENSITIVE_NAME.test(name)) return;

        context.report({ node, messageId: 'secret', data: { name } });
      },
    };
  },
};

export default {
  meta: { name: 'kurdora' },
  rules: {
    'no-physical-direction-classes': noPhysicalDirectionClasses,
    'no-public-env-secrets': noPublicEnvSecrets,
  },
};
