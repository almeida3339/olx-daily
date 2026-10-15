export const ENJOEI_JAPANESE_JEANS = [
  { slug: 'momotaro', brandName: 'Momotaro Jeans', term: 'momotaro', brandPattern: /\bmomotaro\b/ },
  { slug: 'pure-blue-japan', brandName: 'Pure Blue Japan (PBJ)', term: 'pure blue japan', searchTerms: ['pure blue japan', 'pbj'], brandPattern: /\bpure[\s-]+blue[\s-]+japan\b|\bpbj\b/ },
  { slug: 'the-strike-gold', brandName: 'The Strike Gold', term: 'strike gold', brandPattern: /\b(?:the[\s-]+)?strike[\s-]+gold\b/ },
  { slug: 'kapital', brandName: 'Kapital', term: 'kapital', brandPattern: /\bkapital\b/ },
  { slug: 'big-john', brandName: 'Big John', term: 'big john', brandPattern: /\bbig[\s-]*john\b/ },
  { slug: 'fullcount', brandName: 'Fullcount', term: 'fullcount', brandPattern: /\bfull[\s-]*count\b/ },
  { slug: 'orslow', brandName: 'OrSlow', term: 'orslow', searchTerms: ['orslow', 'or slow'], brandPattern: /\bor[\s-]*slow\b/ },
  { slug: 'denime', brandName: 'Denime', term: 'denime', brandPattern: /\bdenime\b/ },
].map(spec => ({ ...spec, id: `enjoei-${spec.slug}`, label: `Enjoei Jeans ${spec.brandName} 40`,
  env: `ENJOEI_${spec.slug.toUpperCase().replaceAll('-', '_')}_DATA_DIR`,
  repoFolder: `enjoei-${spec.slug}`, fallback: `monitor-enjoei-${spec.slug}`, maxAgeHours: 24,
  maxPrice: 350, inclusive: true }));
