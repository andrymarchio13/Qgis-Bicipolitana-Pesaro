/**
 * Linee di prova per i test che hanno bisogno di una mappa `id -> Line` senza
 * dipendere dal file generato dalla pipeline.
 *
 * Le linee rispettano la regola del progetto: cio' che il dataset non contiene
 * resta `null` (nome ufficiale) o `unknown` (stato), mai una stringa inventata.
 */
import type { Line, LngLat } from '../../src/types';

export interface OpzioniLinea {
  nome?: string;
  colore?: string;
  lunghezzaMetri?: number;
  estremi?: { start: LngLat; end: LngLat }[];
  coloreDaConfermare?: boolean;
  coloreInConflittoCon?: string[];
  contigua?: boolean;
  segmenti?: number;
}

/** Velocita' usata per la stima dei minuti, coerente con la pipeline. */
const VELOCITA_KMH = 15;

/** Costruisce una `Line` valida partendo dai soli campi che il test governa. */
export function lineaDiProva(id: string, opzioni: OpzioniLinea = {}): Line {
  const lunghezzaMetri = opzioni.lunghezzaMetri ?? 3000;
  return {
    id,
    name: opzioni.nome ?? `Linea ${id}`,
    officialName: null,
    officialNameSource: 'assente nel dataset di prova',
    color: opzioni.colore ?? '#e4002b',
    colorSource: 'fixture di test',
    colorNeedsConfirmation: opzioni.coloreDaConfermare ?? false,
    colorConflictsWith: opzioni.coloreInConflittoCon ?? [],
    status: 'unknown',
    statusNote: 'Stato non dichiarato dal dataset di prova.',
    lengthMeters: lunghezzaMetri,
    lengthKm: Number((lunghezzaMetri / 1000).toFixed(2)),
    segments: opzioni.segmenti ?? 1,
    contiguous: opzioni.contigua ?? true,
    endpoints: opzioni.estremi ?? [{ start: [12.9, 43.9], end: [12.91, 43.9] }],
    estimatedMinutes: Math.round((lunghezzaMetri / 1000 / VELOCITA_KMH) * 60),
    estimatedMinutesNote: 'Stima a 15 km/h, non una misura.',
  };
}

/**
 * Le due linee usate dai grafi sintetici (`GRAFO_DUE_ITINERARI`,
 * `GRAFO_OSTACOLI`, `GRAFO_DUE_LINEE`): gli id e i colori coincidono con quelli
 * dichiarati sugli archi, altrimenti il router non troverebbe il nome da
 * mostrare nelle istruzioni.
 */
export const LINEE_DI_PROVA = new Map<string, Line>([
  ['1', lineaDiProva('1', { colore: '#e4002b', estremi: [{ start: [12.9, 43.9], end: [12.91, 43.9] }] })],
  ['2', lineaDiProva('2', { colore: '#00843d', estremi: [{ start: [12.9, 43.9], end: [12.909, 43.9] }] })],
]);
