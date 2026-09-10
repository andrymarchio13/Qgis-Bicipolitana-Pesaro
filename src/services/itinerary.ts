/**
 * Salvataggio e ripristino di un itinerario calcolato.
 *
 * Il file salvato contiene il percorso per intero — geometria, tappe,
 * indicazioni, avvisi — insieme ai punti di partenza e arrivo. Reimportandolo
 * si rivede esattamente l'itinerario di prima, senza ricalcolarlo: i dati
 * della rete possono nel frattempo essere cambiati, e un itinerario salvato
 * deve restare quello che l'utente aveva scelto.
 *
 * Accanto al formato dell'applicazione c'e' l'esportazione GPX, che serve a
 * portare il percorso su un ciclocomputer o su un'altra app. Il GPX non si
 * reimporta: perde indicazioni e linee percorse, e sarebbe un ritorno
 * silenziosamente incompleto.
 */
import type { Location, Route } from '../types';

/** Marcatore di formato: distingue i nostri file da un JSON qualsiasi. */
export const ITINERARY_KIND = 'bicipolitana-pesaro/itinerario';

/**
 * Versione del formato. Va alzata solo per cambi incompatibili: la lettura
 * rifiuta le versioni che non conosce invece di indovinare.
 */
export const ITINERARY_VERSION = 1;

/** Estensione dei file salvati dall'applicazione. */
export const ITINERARY_EXTENSION = 'bicipesaro.json';

export interface ItineraryFile {
  kind: typeof ITINERARY_KIND;
  version: number;
  /** Data di salvataggio in ISO 8601. */
  savedAt: string;
  /** Titolo leggibile, dai nomi di partenza e arrivo. */
  title: string;
  origin: Location | null;
  destination: Location | null;
  route: Route;
}

/** Esito della lettura di un file: mai un'eccezione, sempre un messaggio. */
export type ItineraryParseResult =
  | { ok: true; itinerary: ItineraryFile }
  | { ok: false; message: string };

const endpointLabel = (location: Location | null, fallback: string): string =>
  location?.label?.trim() || fallback;

/** Titolo dell'itinerario, usato nella scheda e nel nome del file. */
export function itineraryTitle(origin: Location | null, destination: Location | null): string {
  return `${endpointLabel(origin, 'Partenza')} → ${endpointLabel(destination, 'Arrivo')}`;
}

/**
 * Nome file suggerito. Si tolgono accenti e caratteri che Windows e macOS
 * rifiutano, altrimenti il salvataggio fallisce proprio sui percorsi che hanno
 * un indirizzo completo nel titolo.
 */
export function itineraryFileName(
  origin: Location | null,
  destination: Location | null,
  extension: string,
): string {
  const slug = itineraryTitle(origin, destination)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  return `itinerario-${slug || 'bicipolitana'}-${date}.${extension}`;
}

/** Costruisce il contenuto del file a partire da quanto e' a schermo. */
export function buildItinerary(
  route: Route,
  origin: Location | null,
  destination: Location | null,
): ItineraryFile {
  return {
    kind: ITINERARY_KIND,
    version: ITINERARY_VERSION,
    savedAt: new Date().toISOString(),
    title: itineraryTitle(origin, destination),
    origin,
    destination,
    route,
  };
}

export function serializeItinerary(itinerary: ItineraryFile): string {
  return JSON.stringify(itinerary, null, 2);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isLngLat = (value: unknown): boolean =>
  Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);

const isLocation = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const location = value as Record<string, unknown>;
  return isFiniteNumber(location.lng) && isFiniteNumber(location.lat);
};

const DANNEGGIATO = 'Il percorso salvato nel file è incompleto o danneggiato.';

/**
 * Legge il testo di un file salvato.
 *
 * La validazione controlla che ci sia davvero un percorso percorribile: un
 * file troncato o di un'altra applicazione deve produrre un messaggio, non
 * una mappa vuota o una schermata di errore.
 */
export function parseItinerary(text: string): ItineraryParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Il file non è leggibile: non contiene un itinerario valido.' };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Il file non contiene un itinerario.' };
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== ITINERARY_KIND) {
    return { ok: false, message: 'Questo file non è un itinerario della Bicipolitana di Pesaro.' };
  }
  if (candidate.version !== ITINERARY_VERSION) {
    return {
      ok: false,
      message: `Il file è stato salvato con un'altra versione dell'app (formato ${String(
        candidate.version,
      )}) e non può essere aperto.`,
    };
  }

  const route = candidate.route as Record<string, unknown> | undefined;
  if (!route || typeof route !== 'object') {
    return { ok: false, message: 'Il file non contiene il percorso.' };
  }
  if (!Array.isArray(route.geometry) || route.geometry.length < 2 || !route.geometry.every(isLngLat)) {
    return { ok: false, message: DANNEGGIATO };
  }
  if (!Array.isArray(route.segments) || !Array.isArray(route.instructions)) {
    return { ok: false, message: DANNEGGIATO };
  }
  if (!isFiniteNumber(route.distanceMeters) || !isFiniteNumber(route.durationSeconds)) {
    return { ok: false, message: DANNEGGIATO };
  }
  if (!isLocation(candidate.origin) || !isLocation(candidate.destination)) {
    return { ok: false, message: 'I punti di partenza e arrivo salvati non sono validi.' };
  }

  return { ok: true, itinerary: candidate as unknown as ItineraryFile };
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Esportazione GPX: traccia unica piu' un waypoint per ogni indicazione, cosi'
 * i dispositivi che li leggono mostrano le svolte e non la sola linea.
 */
export function toGpx(itinerary: ItineraryFile): string {
  const { route, origin, destination, title } = itinerary;

  const waypoints = [
    ...(origin ? [{ lng: origin.lng, lat: origin.lat, name: endpointLabel(origin, 'Partenza') }] : []),
    ...route.instructions.map((instruction) => ({
      lng: instruction.location[0],
      lat: instruction.location[1],
      name: instruction.text,
    })),
    ...(destination
      ? [{ lng: destination.lng, lat: destination.lat, name: endpointLabel(destination, 'Arrivo') }]
      : []),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Bicipolitana Pesaro" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXml(title)}</name>`,
    `    <desc>${escapeXml(
      `Percorso ${route.profileLabel}. Distanza e tempi sono stime calcolate dall'applicazione.`,
    )}</desc>`,
    `    <time>${itinerary.savedAt}</time>`,
    '  </metadata>',
    ...waypoints.map((point) =>
      [
        `  <wpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">`,
        `    <name>${escapeXml(point.name)}</name>`,
        '  </wpt>',
      ].join('\n'),
    ),
    '  <trk>',
    `    <name>${escapeXml(title)}</name>`,
    '    <trkseg>',
    ...route.geometry.map(
      ([lng, lat]) => `      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}" />`,
    ),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n');
}

/**
 * Scarica un testo come file. Il link temporaneo e' l'unico modo che funziona
 * anche nei browser mobili, dove `showSaveFilePicker` non esiste.
 */
export function downloadText(fileName: string, mimeType: string, text: string): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revocare subito interrompe il download su alcuni browser: si lascia il
  // tempo di servire il click.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Legge un file scelto dall'utente e ne valida il contenuto. */
export async function readItineraryFile(file: File): Promise<ItineraryParseResult> {
  try {
    return parseItinerary(await file.text());
  } catch {
    return { ok: false, message: 'Non è stato possibile leggere il file selezionato.' };
  }
}
