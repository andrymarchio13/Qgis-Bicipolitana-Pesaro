/**
 * Simboli e colori dei punti di interesse.
 *
 * Si usano emoji invece di uno sprite grafico: nessun file da caricare,
 * nessuna dipendenza esterna e resa identica sulla mappa e nei pannelli.
 */
import type { PoiCategory, PoiKind } from '../types';

export const POI_EMOJI: Record<PoiCategory | string, string> = {
  fontanella: '💧',
  parcheggio_bici: '🅿️',
  noleggio: '🔑',
  officina: '🔧',
  negozio_bici: '🚲',
  altro_servizio: 'ℹ️',
  parco: '🌳',
  belvedere: '👁️',
  area_picnic: '🧺',
  panchina: '🪑',
  binocolo: '🔭',
  altro_svago: '📍',
  barriera_ciclabile: '⚠️',
  barriera_doppia: '⛔',
  barriera_tripla: '⛔',
  chicane: '↩️',
  altra_barriera: '⚠️',
  ostacolo_generico: '⚠️',
};

/** Colore del bordo del marcatore, per distinguere i tre gruppi a colpo d'occhio. */
export const POI_KIND_COLOR: Record<PoiKind, string> = {
  servizio: '#0f6b45',
  ostacolo: '#b45309',
  svago: '#0d9488',
};

export const poiEmoji = (category: string): string => POI_EMOJI[category] ?? '📍';
