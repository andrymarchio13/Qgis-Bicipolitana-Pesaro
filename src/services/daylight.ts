/**
 * Luce del giorno e percorso: si torna prima del buio?
 *
 * Per una gita e' la seconda domanda dopo la pioggia, e nessuno dei due dati
 * da solo la risolve: l'ora del tramonto la dichiara il servizio meteo, il
 * tempo di percorrenza lo stima il calcolo del percorso, e l'illuminazione
 * delle strade sta nei dati OSM del progetto. Qui si incrociano.
 *
 * Vale la regola sui dati anche per il buio: l'assenza del tag `lit` NON
 * significa strada senza lampioni. Un tratto non dichiarato resta non
 * dichiarato, contato a parte, e mai sommato a quelli dichiarati al buio —
 * altrimenti l'app spaventerebbe con un numero che nessuno ha misurato.
 */
import type { LightingSpan } from '../types';

export interface DarknessOnRoute {
  /** Ora di arrivo stimata partendo adesso. */
  arrival: Date;
  /** Tramonto dichiarato dal servizio meteo. */
  sunset: Date;
  /** Secondi di percorso da fare dopo il tramonto. */
  darkSeconds: number;
  /**
   * Metri percorsi dopo il tramonto. Vale 0 quando il percorso non porta con
   * se' i tratti (un itinerario salvato prima): il tempo al buio resta certo,
   * la distanza no, e non la si stima.
   */
  darkMeters: number;
  /** Di quei metri, quelli su strade dichiarate illuminate. */
  litMeters: number;
  /** ...quelli su strade dichiarate NON illuminate. */
  unlitMeters: number;
  /** ...e quelli su cui i dati non dicono nulla. */
  unknownMeters: number;
  /** true quando si parte che e' gia' buio. */
  startsInDark: boolean;
}

export interface DaylightInput {
  /** Puo' mancare: un itinerario salvato da una versione precedente non ce l'ha. */
  lighting: LightingSpan[] | undefined;
  durationSeconds: number;
  /** Momento della partenza: normalmente adesso. */
  departure: Date;
  sunset: Date | null;
}

/**
 * Quanto del percorso cade dopo il tramonto, e com'e' illuminato.
 *
 * Restituisce null quando non c'e' niente da dire: manca l'ora del tramonto,
 * oppure si arriva con la luce. Un avviso che compare sempre non lo legge
 * piu' nessuno.
 */
export function darknessOnRoute({
  lighting,
  durationSeconds,
  departure,
  sunset,
}: DaylightInput): DarknessOnRoute | null {
  if (!sunset || durationSeconds <= 0) return null;

  const arrival = new Date(departure.getTime() + durationSeconds * 1000);
  if (arrival.getTime() <= sunset.getTime()) return null;

  // Secondi dalla partenza al tramonto: negativo se e' gia' buio in partenza.
  const secondsToSunset = (sunset.getTime() - departure.getTime()) / 1000;
  const startsInDark = secondsToSunset <= 0;

  /*
   * Il tempo al buio non dipende dai tratti ma solo dall'orologio: e' quel
   * che resta del viaggio dopo il tramonto. Si calcola a parte, cosi' resta
   * giusto anche per un percorso che non porta con se' l'illuminazione.
   */
  const darkSeconds = Math.round(
    durationSeconds - Math.min(Math.max(secondsToSunset, 0), durationSeconds),
  );

  let darkMeters = 0;
  let litMeters = 0;
  let unlitMeters = 0;
  let unknownMeters = 0;

  for (const span of lighting ?? []) {
    const end = span.fromSeconds + span.durationSeconds;
    if (end <= secondsToSunset) continue;

    /*
     * Il tratto a cavallo del tramonto si divide in proporzione: e' una
     * ripartizione dichiarata, non una misura di dove ci si trovera'
     * esattamente al calare del sole.
     */
    const overlap = Math.min(
      span.durationSeconds,
      end - Math.max(span.fromSeconds, secondsToSunset),
    );
    if (overlap <= 0) continue;
    const share = span.durationSeconds > 0 ? overlap / span.durationSeconds : 1;
    const meters = span.distanceMeters * share;

    darkMeters += meters;
    if (span.lit === true) litMeters += meters;
    else if (span.lit === false) unlitMeters += meters;
    else unknownMeters += meters;
  }

  return {
    arrival,
    sunset,
    darkSeconds,
    darkMeters: Math.round(darkMeters),
    litMeters: Math.round(litMeters),
    unlitMeters: Math.round(unlitMeters),
    unknownMeters: Math.round(unknownMeters),
    startsInDark,
  };
}

/** Ore e minuti di un istante, come si leggono su un orologio. */
export function clockTime(date: Date): string {
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
