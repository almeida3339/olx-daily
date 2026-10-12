import { normalizeMonitorText } from './monitor-core.mjs';

export function isCompleteOledMonitor(item) {
  const title = normalizeMonitorText(item?.title ?? item?.fullTitle ?? '').trim();
  return !/^(?:placa(?:[- ](?:principal|fonte|logica|mae))?|mainboard|fonte(?: de alimentacao)?|carcaca|base|suporte|cabo|adaptador)\b/.test(title)
    && !/\b(?:somente|apenas) (?:a )?(?:placa|carcaca|base|tela)\b/.test(title);
}
