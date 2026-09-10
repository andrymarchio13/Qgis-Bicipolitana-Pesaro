/**
 * Cosa si incontra lungo il percorso.
 *
 * I POI del progetto sono gia' sulla mappa, ma per una gita la domanda non e'
 * «dove sono le fontanelle di Pesaro»: e' «dove posso riempire la borraccia
 * lungo la strada che sto per fare, e dopo quanto». Qui i punti del
 * GeoPackage vengono messi in relazione con il percorso scelto: a che
 * chilometro cadono e quanto bisogna deviare per raggiungerli.
 *
 * Nessun punto viene inventato o spostato: si proietta quello che c'e'.
 */
import type { LngLat, Poi, PoiCategory } from '../types';
import { projectOnLine } from '../utils/geo';

export interface PoiAlongRoute {
  poi: Poi;
  /** Metri dall'inizio del percorso al punto piu' vicino al POI. */
  offsetMeters: number;
  /** Quanto il POI dista dal percorso: e' la deviazione da fare. */
  detourMeters: number;
}

/**
 * Categorie che servono davvero mentre si pedala.
 *
 * Le barriere restano fuori: sono gia' avvisi del percorso, e non sono cose
 * che si va a cercare.
 */
export const CATEGORIE_UTILI: PoiCategory[] = [
  'fontanella',
  'officina',
  'negozio_bici',
  'noleggio',
  'parcheggio_bici',
  'belvedere',
  'parco',
  'area_picnic',
];

/**
 * Quanto ci si puo' allontanare dal percorso perche' un punto conti come
 * "lungo la strada". Duecento metri sono meno di un minuto di bici: oltre,
 * non e' piu' una sosta al volo ma una deviazione da decidere.
 */
export const DETOUR_DEFAULT_METERS = 200;

/**
 * I punti utili lungo il percorso, in ordine di incontro.
 *
 * Un punto vicinissimo all'arrivo non viene escluso: si e' comunque a
 * destinazione, ma sapere che l'ultima fontanella era al chilometro otto e'
 * proprio l'informazione che serve.
 */
export function poisAlongRoute(
  pois: Poi[],
  geometry: LngLat[],
  options: { maxDetourMeters?: number; categories?: PoiCategory[] } = {},
): PoiAlongRoute[] {
  if (geometry.length < 2) return [];

  const maxDetour = options.maxDetourMeters ?? DETOUR_DEFAULT_METERS;
  const categories = new Set<PoiCategory>(options.categories ?? CATEGORIE_UTILI);

  const found: PoiAlongRoute[] = [];
  for (const poi of pois) {
    if (!categories.has(poi.category)) continue;
    const projected = projectOnLine([poi.lng, poi.lat], geometry);
    if (projected.distanceMeters > maxDetour) continue;
    found.push({
      poi,
      offsetMeters: Math.round(projected.offsetMeters),
      detourMeters: Math.round(projected.distanceMeters),
    });
  }

  return found.sort((a, b) => a.offsetMeters - b.offsetMeters);
}

/** Solo l'acqua: in una gita e' la categoria che si cerca per prima. */
export function waterAlongRoute(along: PoiAlongRoute[]): PoiAlongRoute[] {
  return along.filter((item) => item.poi.category === 'fontanella');
}

/**
 * Il tratto piu' lungo senza fontanelle, e da che chilometro comincia.
 *
 * E' l'informazione che decide quanta acqua portarsi. Il conto include
 * l'ultimo pezzo fino all'arrivo: dopo l'ultima fontanella non c'e' piu'
 * niente, ed e' proprio quello il tratto scoperto.
 */
export function longestDryStretch(
  water: PoiAlongRoute[],
  routeLengthMeters: number,
): { fromMeters: number; lengthMeters: number } {
  let previous = 0;
  // Si parte da zero e non dalla lunghezza totale: senza fontanelle il conto
  // finale sul tratto di coda restituisce comunque l'intero percorso.
  let worst = { fromMeters: 0, lengthMeters: 0 };

  for (const item of water) {
    const gap = item.offsetMeters - previous;
    if (gap > worst.lengthMeters) worst = { fromMeters: previous, lengthMeters: gap };
    previous = item.offsetMeters;
  }

  const tail = routeLengthMeters - previous;
  if (tail > worst.lengthMeters) worst = { fromMeters: previous, lengthMeters: tail };

  return { fromMeters: Math.round(worst.fromMeters), lengthMeters: Math.round(worst.lengthMeters) };
}
