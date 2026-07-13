export const ENJOEI_SHOE_TERMS = [
  "barefoot",
  "feet of tomorrow",
  "fot",
  "vita barefoot",
  "vivobarefoot",
  "xero",
  "vibram fivefingers",
  "merrell",
  "lems",
];

const EXCLUDED_FOOTWEAR_TERMS = [
  "mocassim",
  "mocasin",
  "sapato social",
  "sapato casual",
  "sapatilha",
  "scarpin",
  "sandalia",
  "chinelo",
  "bota",
  "coturno",
];

export function matchesEnjoeiShoeSearchTerm(item, searchTerm) {
  const text = normalizeComparableText(`${item.title ?? ""} ${item.brand ?? ""}`);
  if (EXCLUDED_FOOTWEAR_TERMS.some((term) => hasWord(text, term))) return false;

  const term = normalizeComparableText(searchTerm);
  if (term === "fot") return hasWord(text, "fot") || text.includes("feet of tomorrow");
  return hasWord(text, term) || text.includes(term);
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
    .toLowerCase();
}
