export const ML_NOTEBOOK_COLLECTION_MIN_BRL = 2000;
export const ML_NOTEBOOK_COLLECTION_MAX_BRL = 10000;
export const ML_NOTEBOOK_DISPLAY_MIN_BRL = 2000;
export const ML_NOTEBOOK_DISPLAY_MAX_BRL = 8000;

export function isMercadoLivreNotebookDisplayPrice(price) {
  return Number.isFinite(Number(price))
    && Number(price) >= ML_NOTEBOOK_DISPLAY_MIN_BRL
    && Number(price) <= ML_NOTEBOOK_DISPLAY_MAX_BRL;
}
