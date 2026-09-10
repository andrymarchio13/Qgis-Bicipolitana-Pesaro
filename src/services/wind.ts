/**
 * Il vento rispetto alla strada che si fa.
 *
 * «Vento da NE a 22 km/h» non dice niente a chi sta per partire: quel che
 * conta e' se lo si prende in faccia o nella schiena. Qui si confronta la
 * direzione da cui soffia — misurata dal servizio meteo — con la direzione di
 * marcia lungo il percorso, tratto per tratto, pesando ogni tratto per la sua
 * lunghezza.
 *
 * Non c'e' niente di stimato nel confronto: sono due angoli. Dichiarate sono
 * le soglie con cui si decide quando un vento e' "contrario" e quando conta
 * abbastanza da parlarne.
 */
import type { LngLat } from '../types';
import { bearing, haversine } from '../utils/geo';

export type WindRelation = 'contro' | 'laterale' | 'favore';

export interface WindOnRoute {
  /** Metri percorsi con il vento in faccia. */
  headMeters: number;
  /** Metri con vento laterale. */
  crossMeters: number;
  /** Metri con il vento nella schiena. */
  tailMeters: number;
  /** La condizione prevalente sul percorso. */
  prevailing: WindRelation;
  /** Frazione 0..1 del percorso nella condizione prevalente. */
  prevailingShare: number;
  /** Velocita' del vento dichiarata dal servizio, in km/h. */
  speedKmh: number;
}

/**
 * Sotto questa velocita' il vento non cambia la pedalata e non se ne parla.
 *
 * E' la stessa soglia oltre la quale la scheda meteo comincia a commentare il
 * vento: sotto i 12 km/h la scala Beaufort parla di brezza leggera.
 */
export const WIND_MIN_KMH = 12;

/** Oltre 60° dalla direzione di marcia il vento smette di essere frontale. */
const HEAD_ANGLE = 60;
/** Oltre 120° e' spinta da dietro. */
const TAIL_ANGLE = 120;

/**
 * Come si prende il vento lungo il percorso.
 *
 * `windDirection` e' la direzione **da cui** soffia, come la dichiara
 * Open-Meteo: un vento "da 0°" viene da nord e spinge verso sud.
 *
 * Restituisce null quando non c'e' niente da dire: vento assente o troppo
 * debole, dato mancante, percorso senza geometria utile.
 */
export function windOnRoute(
  geometry: LngLat[],
  windDirection: number | null,
  speedKmh: number | null,
): WindOnRoute | null {
  if (
    windDirection === null ||
    speedKmh === null ||
    !Number.isFinite(windDirection) ||
    !Number.isFinite(speedKmh) ||
    speedKmh < WIND_MIN_KMH ||
    geometry.length < 2
  ) {
    return null;
  }

  let headMeters = 0;
  let crossMeters = 0;
  let tailMeters = 0;

  for (let i = 1; i < geometry.length; i += 1) {
    const from = geometry[i - 1]!;
    const to = geometry[i]!;
    const length = haversine(from, to);
    if (length <= 0) continue;

    /*
     * Angolo fra la direzione di marcia e quella da cui arriva il vento:
     * 0° significa vento esattamente in faccia, 180° esattamente in spalla.
     */
    const travel = bearing(from, to);
    const delta = Math.abs(((windDirection - travel + 540) % 360) - 180);

    if (delta < HEAD_ANGLE) headMeters += length;
    else if (delta > TAIL_ANGLE) tailMeters += length;
    else crossMeters += length;
  }

  const total = headMeters + crossMeters + tailMeters;
  if (total <= 0) return null;

  const prevailing: WindRelation =
    headMeters >= crossMeters && headMeters >= tailMeters
      ? 'contro'
      : tailMeters >= crossMeters
        ? 'favore'
        : 'laterale';
  const prevailingMeters =
    prevailing === 'contro' ? headMeters : prevailing === 'favore' ? tailMeters : crossMeters;

  return {
    headMeters: Math.round(headMeters),
    crossMeters: Math.round(crossMeters),
    tailMeters: Math.round(tailMeters),
    prevailing,
    prevailingShare: prevailingMeters / total,
    speedKmh,
  };
}

/** Come si racconta, in una riga, il vento di questo percorso. */
export function windSummary(wind: WindOnRoute): { icon: string; text: string } {
  const percento = Math.round(wind.prevailingShare * 100);
  const kmh = Math.round(wind.speedKmh);

  if (wind.prevailing === 'contro') {
    return {
      icon: '🌬️',
      text: `Vento contro per il ${percento}% del percorso (${kmh} km/h): metti in conto qualche minuto in più.`,
    };
  }
  if (wind.prevailing === 'favore') {
    return {
      icon: '💨',
      text: `Vento a favore per il ${percento}% del percorso (${kmh} km/h).`,
    };
  }
  return {
    icon: '🍃',
    text: `Vento di traverso per il ${percento}% del percorso (${kmh} km/h).`,
  };
}
