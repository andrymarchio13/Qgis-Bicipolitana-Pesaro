/**
 * Riepilogo del viaggio appena concluso.
 *
 * Alla fine di una navigazione ci sono due viaggi da distinguere: quello
 * calcolato — la distanza e il tempo stimati prima di partire — e quello
 * davvero percorso, che dura quanto e' durato e comprende le soste ai semafori.
 * Qui si tengono separati, perche' confonderli darebbe medie inventate.
 *
 * Sta fuori dai componenti perche' e' la parte con una regola da rispettare:
 * una media si calcola solo quando i numeri da cui nasce hanno un senso, e
 * quando non ce l'hanno il campo resta vuoto invece di mostrare uno zero o un
 * valore assurdo.
 */
import type { Route } from '../types';
import { formatDuration } from '../utils/geo';
import { spokenDistance } from './voice';

/** Quel che la navigazione ha misurato mentre si pedalava. */
export interface TripStats {
  /** Istante di avvio della navigazione, o null se non e' mai partita. */
  startedAt: number | null;
  /** Secondi trascorsi dall'avvio all'arrivo. */
  elapsedSeconds: number;
  /** Progressiva massima raggiunta lungo il percorso, in metri. */
  traveledMeters: number;
  /** Velocita' massima letta dal GPS, in km/h, o null se il dato manca. */
  maxSpeedKmh: number | null;
}

export interface TripSummary {
  /** Metri effettivamente percorsi lungo il tracciato. */
  distanceMeters: number;
  /** Metri del percorso calcolato, per il confronto. */
  plannedMeters: number;
  /** Durata reale della navigazione, in secondi. */
  elapsedSeconds: number;
  /** Durata stimata prima di partire, in secondi. */
  plannedSeconds: number;
  /**
   * Differenza fra il tempo reale e quello stimato, in secondi: positiva se
   * si e' impiegato di piu'. null quando il confronto non regge, cioe' quando
   * la navigazione non ha coperto l'intero percorso.
   */
  deltaSeconds: number | null;
  /** Media in km/h, o null quando i numeri sono troppo piccoli per una media. */
  averageSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  bicipolitanaMeters: number;
  bicipolitanaPercentage: number;
  /** Metri fuori dalla rete del progetto: raccordi a piedi o in bicicletta. */
  connectorMeters: number;
  linesUsed: string[];
  /**
   * true quando il viaggio e' stato seguito dall'inizio alla fine. Se si avvia
   * la navigazione a meta' strada, o si arriva con un percorso ricalcolato, il
   * riepilogo racconta solo la parte navigata e va detto.
   */
  complete: boolean;
}

/** Sotto questi valori una media oraria non significa nulla. */
const MIN_SECONDS_FOR_AVERAGE = 60;
const MIN_METERS_FOR_AVERAGE = 250;

export function buildTripSummary(route: Route, stats: TripStats): TripSummary {
  const plannedMeters = route.distanceMeters;
  /*
   * La progressiva non supera mai la lunghezza del percorso, ma l'arrivo
   * scatta qualche metro prima della fine: il viaggio si considera completo
   * quando manca meno di un decimo del totale, e in quel caso la distanza
   * mostrata e' quella del percorso, non una cifra tronca per l'ultima curva.
   */
  const traveled = clamp(stats.traveledMeters, 0, plannedMeters);
  const complete = plannedMeters > 0 && traveled >= plannedMeters * 0.9;
  const distanceMeters = complete ? plannedMeters : traveled;

  const elapsedSeconds = Math.max(0, Math.round(stats.elapsedSeconds));
  const plannedSeconds = route.durationSeconds;

  const averageSpeedKmh =
    elapsedSeconds >= MIN_SECONDS_FOR_AVERAGE && distanceMeters >= MIN_METERS_FOR_AVERAGE
      ? (distanceMeters / elapsedSeconds) * 3.6
      : null;

  // La quota su Bicipolitana e' quella del percorso calcolato: sui metri
  // davvero percorsi il dato non esiste, e stimarlo in proporzione sarebbe
  // inventare. Per questo il confronto ha senso solo a viaggio completo.
  const bicipolitanaMeters = complete ? route.bicipolitanaMeters : 0;
  const connectorMeters = complete ? route.walkingMeters : 0;

  return {
    distanceMeters,
    plannedMeters,
    elapsedSeconds,
    plannedSeconds,
    deltaSeconds: complete && plannedSeconds > 0 ? elapsedSeconds - plannedSeconds : null,
    averageSpeedKmh,
    maxSpeedKmh: stats.maxSpeedKmh,
    bicipolitanaMeters,
    bicipolitanaPercentage: complete ? route.bicipolitanaPercentage : 0,
    connectorMeters,
    linesUsed: complete ? route.linesUsed : [],
    complete,
  };
}

/**
 * Il riepilogo detto ad alta voce, all'arrivo.
 *
 * Due frasi al massimo: chi ha appena messo il piede a terra non ascolta un
 * elenco. Distanza e tempo sempre, la media solo quando esiste, la quota di
 * Bicipolitana solo quando e' una parte rilevante del viaggio.
 */
export function spokenTripRecap(summary: TripSummary): string {
  const parti: string[] = [];
  const distanza = spokenDistance(summary.distanceMeters);
  const tempo = spokenDuration(summary.elapsedSeconds);

  if (!distanza || !tempo) return '';

  parti.push(`Hai percorso ${distanza} in ${tempo}`);
  if (summary.averageSpeedKmh !== null) {
    parti.push(`a una media di ${Math.round(summary.averageSpeedKmh)} chilometri orari`);
  }

  const frasi = [`${parti.join(', ')}.`];
  if (summary.bicipolitanaPercentage >= 25) {
    frasi.push(`${summary.bicipolitanaPercentage} per cento sulla Bicipolitana.`);
  }
  return frasi.join(' ');
}

/**
 * Una durata come la direbbe una persona.
 *
 * `formatDuration` scrive "1 h 5 min", che la sintesi vocale legge "uno acca
 * cinque min": qui le unita' sono per esteso.
 */
export function spokenDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minuti = Math.round(seconds / 60);
  if (minuti < 1) return 'meno di un minuto';
  if (minuti === 1) return 'un minuto';
  if (minuti < 60) return `${minuti} minuti`;
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  const oreText = ore === 1 ? "un'ora" : `${ore} ore`;
  if (resto === 0) return oreText;
  return `${oreText} e ${resto === 1 ? 'un minuto' : `${resto} minuti`}`;
}

/**
 * Il confronto fra tempo reale e tempo stimato, detto in una riga.
 *
 * Sotto il minuto e mezzo la differenza non e' un risultato: e' il margine di
 * una stima, e presentarla come uno scarto attribuirebbe ai tempi calcolati
 * una precisione che non hanno.
 */
export function describeDelta(deltaSeconds: number, plannedSeconds: number): string {
  const stima = formatDuration(plannedSeconds);
  if (Math.abs(deltaSeconds) < 90) return `In linea con la stima di ${stima}.`;
  const scarto = formatDuration(Math.abs(deltaSeconds));
  return deltaSeconds < 0
    ? `${scarto} in meno della stima di ${stima}.`
    : `${scarto} in più della stima di ${stima}.`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max <= min) return min;
  return Math.min(max, Math.max(min, value));
}
