/**
 * Strade a traffico intenso: riconoscimento e misura.
 *
 * Statali e provinciali sono percorribili in bicicletta, ma non sono un
 * itinerario ciclabile: affiancare le auto sulla Statale 746 o sulla
 * Provinciale 423 e' esattamente cio' che questa applicazione dovrebbe
 * evitare. Vengono marcate a monte dalla pipeline — che vede il riferimento
 * amministrativo OSM (`ref=SS746`), il dato che dice davvero quanto traffico ci
 * passa — e qui si limitano a essere riconosciute.
 */
import { BUSY_HIGHWAY_CLASSES } from '../../config';
import type { GraphEdge } from '../../types';

/**
 * True se l'arco e' una strada a traffico intenso.
 *
 * Il flag `bs` e' l'informazione autorevole, perche' nasce dai tag completi
 * dell'estratto OSM. Il controllo sulla classe resta come rete di sicurezza per
 * un grafo generato prima che il flag esistesse: senza, quel grafo tornerebbe
 * silenziosamente a mandare i percorsi sulle statali.
 */
export function isBusyRoad(edge: GraphEdge): boolean {
  if (edge.bs === 1) return true;
  return edge.k === 1 && BUSY_HIGHWAY_CLASSES.has(edge.hw ?? '');
}

/** Come si chiama la strada, per poterla nominare in un avviso. */
export function busyRoadLabel(edge: GraphEdge): string | null {
  return edge.rf ?? edge.n ?? null;
}
