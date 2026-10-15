export const SHOE_RULES_VERSION = 3;
export const FOT_ALLOWED_MODELS = ['walka', 'lito', 'noga', 'voet', 'bruk'];
export const ENJOEI_SHOE_TERMS = [
  'fiber', 'barefoot', 'feet of tomorrow', ...FOT_ALLOWED_MODELS.map(model => `fot ${model}`), 'vita barefoot', 'vivobarefoot', 'vivo barefoot',
  'xero', 'vibram fivefingers', 'fivefingers', 'five fingers', 'vapor glove', 'trail glove',
  'merrell', 'lems', 'saguaro', 'whitin', 'hobibear', 'groundies', 'be lenka', 'freet',
  'minimalistas', 'zero drop', 'drop zero', 'minimalista', 'fot',
];

const EXCLUDED_FOOTWEAR_TERMS = [
  "mocassim",
  "mocasin",
  "sapato social",
  "sapato casual",
  "scarpin",
  "sandalia",
  "chinelo",
  "bota",
  "coturno",
];

export function matchesEnjoeiShoeSearchTerm(item, searchTerm) {
  const text = normalizeComparableText(`${item.title ?? ""} ${item.brand ?? ""}`);
  if (EXCLUDED_FOOTWEAR_TERMS.some((term) => hasWord(text, term))) return false;
  if (hasWord(text, 'sapatilha') && !/\bfive\s*fingers\b/.test(text)) return false;

  const term = normalizeComparableText(searchTerm);
  if (['fivefingers', 'five fingers', 'vibram fivefingers'].includes(term)) return /\bfive\s*fingers\b/.test(text);
  if (['vivobarefoot', 'vivo barefoot'].includes(term)) return /\bvivo\s*barefoot\b/.test(text);
  if (term === 'vita barefoot') return /\bvita\s*barefoot\b/.test(text);
  if (['minimalista', 'minimalistas'].includes(term)) return /\bminimalistas?\b/.test(text);
  if (['zero drop', 'drop zero'].includes(term)) return /\b(?:zero drop|drop zero|drop\s*(?:de\s*)?0|0\s*drop)\b/.test(text);
  if (term === "fot") return hasWord(text, "fot") || text.includes("feet of tomorrow");
  if (term.startsWith('fot ')) return /\b(?:fot|feet of tomorrow)\b/.test(text) && hasWord(text, term.slice(4));
  return hasWord(text, term);
}

function hasWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function normalizeComparableText(text) {
  return (text ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyBarefootShoe(item, description = '') {
  const listing = normalizeComparableText(`${item.title ?? ''} ${item.brand ?? ''}`);
  const text = `${listing} ${normalizeComparableText(description)}`;
  if (!ENJOEI_SHOE_TERMS.some(term => matchesEnjoeiShoeSearchTerm(item, term))) {
    return { state: 'rejected', reason: 'Sem evidência relevante no título ou marca' };
  }
  if (/\bnao (?:e |sao )?(?:barefoot|minimalista)|\bnot barefoot\b|\bnao (?:tem|possui) (?:zero drop|drop zero|biqueira larga)\b/.test(text)) {
    return { state: 'rejected', reason: 'Anúncio declara que não é barefoot/minimalista' };
  }
  if (/\b(?:feet of tomorrow|fot)\b/.test(text)) {
    const namedInListing = FOT_ALLOWED_MODELS.find(model => hasWord(listing, model));
    const modelText = namedInListing ? listing : text;
    if (/\b(?:urban|rudo|kava|yuva)\b/.test(modelText)) return { state: 'rejected', reason: 'Modelo FOT fora da seleção: Walka, Lito, Noga, Voet e Bruk' };
    const selected = namedInListing ?? FOT_ALLOWED_MODELS.find(model => hasWord(text, model));
    return selected ? { state: 'confirmed', reason: `FOT ${selected}: modelo selecionado`, model: selected }
      : { state: 'pending', reason: 'FOT: falta identificar um dos cinco modelos selecionados' };
  }
  if (hasWord(text, 'fiber')) {
    if (/\b(?:fly|recovery|running fire|maxis|echoa)\b/.test(text)) return { state: 'rejected', reason: 'Fiber: linha fora da seleção barefoot' };
    if (/\b(?:barefoot\s+(?:ultra|free|racing)|(?:ultra|free|racing)\s+barefoot)\b/.test(text)
        || /\bfiber\s+(?:ultra|free|racing)\b/.test(text)) return { state: 'confirmed', reason: 'Fiber: linha de tênis barefoot identificada' };
    return { state: 'pending', reason: 'Fiber: falta confirmar modelo de tênis barefoot' };
  }
  const known = /\b(?:vivo\s*barefoot|xero(?: shoes)?|lems|groundies|be lenka|freet|vita\s*barefoot)\b/.test(listing);
  const model = /\bfive\s*fingers\b|\b(?:vapor|trail) glove\b/.test(listing)
    || (/\bmerrell\b/.test(listing) && /\b(?:vapor|trail) glove\b/.test(text));
  if (known || model) return { state: 'confirmed', reason: 'Marca ou linha minimalista identificada no anúncio' };
  const broad = /\b(?:biqueira|frente|forma|ponta|toe box)\s+(?:anatomic\w*|larg\w*|wide)|\bwide toe box\b/.test(text);
  const flat = /\b(?:zero drop|drop zero|drop\s*(?:de\s*)?0|0\s*drop|sem desnivel|sem elevacao)\b/.test(text);
  const flexible = /\b(?:sola|solado)\s+(?:fin[oa]|flexivel)|\bflexible sole\b/.test(text);
  if (broad && flat && flexible) return { state: 'confirmed', reason: 'Descrição declara biqueira larga, zero drop e solado fino/flexível' };
  if (description && !broad && !flat && !flexible && /\b(?:terno|sofisticad\w*|acabamento premium|visual urbano|design minimalista)\b/.test(text)) {
    return { state: 'rejected', reason: 'Descrição usa minimalista como estilo casual, sem características barefoot' };
  }
  return { state: 'pending', reason: /\bmerrell\b/.test(listing)
    ? 'Merrell: falta confirmar a linha/modelo minimalista'
    : 'Termo ou marca é candidato; faltam características barefoot na descrição' };
}

export function isConfirmedBarefootShoe(item) {
  // Always enforce current brand/model preferences, even on saved validations.
  const current = classifyBarefootShoe(item ?? {}, item?.description_evidence ?? '');
  if (current.state === 'rejected') return false;
  return item?.barefoot_validation?.version === SHOE_RULES_VERSION
    ? item.barefoot_validation.state === 'confirmed'
    : classifyBarefootShoe(item ?? {}).state === 'confirmed';
}

export function barefootPriority(item) {
  const text = normalizeComparableText(`${item.title ?? ''} ${item.brand ?? ''}`);
  return /\b(?:fiber|fot|feet of tomorrow)\b/.test(text) ? 0 : 1;
}

export function filterBarefootReport(report, detailsByUrl = new Map()) {
  let section = '';
  const lines = report.split('\n').filter(line => {
    if (line.startsWith('## ')) section = line;
    if (!/^## (?:Novos produtos|Mudancas de preco|Mudanças de preço|Produtos ainda ativos)/.test(section)) return true;
    const url = line.match(/https?:\/\/\S+/)?.[0]?.replace(/[.,)]+$/, '');
    return !url || isConfirmedBarefootShoe(detailsByUrl.get(url) ?? { title: line });
  });
  const count = heading => {
    let active = false, total = 0;
    for (const line of lines) {
      if (line.startsWith('## ')) active = heading.test(line);
      else if (active && line.startsWith('- ') && /https?:\/\//.test(line)) total++;
    }
    return total;
  };
  return lines.map(line => /^- Novos produtos:/.test(line)
    ? line.replace(/\*\*\d+\*\*/, `**${count(/^## Novos produtos/)}**`)
    : /^- Altera[cç][oõ]es de pre[cç]o:/.test(line)
      ? line.replace(/\*\*\d+\*\*/, `**${count(/^## Mudan[cç]as de pre[cç]o/)}**`) : line).join('\n');
}
