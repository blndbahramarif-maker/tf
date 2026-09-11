/**
 * Structured data.
 *
 * The payload contains seller-written text, so `<` is escaped before it is
 * injected. Without that, a title containing `</script>` would close the block
 * and everything after it would be parsed as HTML — a stored XSS in what looks
 * like an inert metadata tag. JSON's own escaping does not cover this, because
 * `<` is a perfectly legal JSON character.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const serialised = JSON.stringify(data).replace(/</g, '\\u003c');

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialised }} />;
}
