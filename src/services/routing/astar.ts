/**
 * Ricerca del cammino minimo con A*.
 *
 * L'euristica e' la distanza in linea d'aria divisa per la velocita' massima
 * teorica raggiungibile: cosi' non sovrastima mai il costo residuo e il
 * risultato resta ottimo (euristica ammissibile).
 */
import {
  BUSY_ROAD_ESCAPE_METERS,
  BUSY_ROAD_PENALTY_FACTOR,
  DANGER_BOOST,
} from '../../config';
import type { GraphEdge, LngLat, RoutingProfile } from '../../types';
import { haversine } from '../../utils/geo';
import { isBusyRoad } from './busy';
import type { AdjacencyEntry, RoutingGraphView } from './graph';

/**
 * Come trattare statali, provinciali e grandi arterie urbane.
 *
 *   - `forbid`   non si percorrono, salvo il margine di uscita attorno ai due
 *                capi del viaggio (`BUSY_ROAD_ESCAPE_METERS`): chi abita sulla
 *                statale ci si immette comunque, ma in mezzo al percorso
 *                resta vietata;
 *   - `penalise` si possono percorrere, a un costo che le rende l'ultima
 *                risorsa e ne riduce i metri al minimo;
 *   - assente    nessun trattamento a parte, oltre al peso della sicurezza.
 */
export type BusyRoadPolicy = 'forbid' | 'penalise';

export interface SearchStep {
  edge: GraphEdge;
  from: number;
  to: number;
  reversed: boolean;
}

export interface SearchResult {
  steps: SearchStep[];
  totalCost: number;
  visitedNodes: number;
}

/** Coda di priorita' a heap binario, sufficiente per grafi di questa scala. */
class MinHeap {
  private readonly keys: number[] = [];

  private readonly values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): { key: number; value: number } | null {
    if (this.keys.length === 0) return null;
    const key = this.keys[0];
    const value = this.values[0];
    const lastKey = this.keys.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.keys.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.keys.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return { key, value };
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.values[a], this.values[b]] = [this.values[b], this.values[a]];
  }
}

/**
 * Costo di attraversamento di un arco secondo il profilo scelto.
 *
 * Parte dal tempo stimato (`edge.t`) e applica, nell'ordine:
 *   - il fattore di tipo (Bicipolitana favorita o meno);
 *   - il peso della sicurezza: piu' un arco e' esposto, piu' costa;
 *   - la penalita' per ostacoli presenti sull'arco;
 *   - la penalita' per cambio di linea rispetto all'arco precedente.
 */
export function edgeCost(
  edge: GraphEdge,
  profile: RoutingProfile,
  previousLineId: string | null,
): number {
  let cost = edge.t;

  if (edge.k === 0) cost *= profile.bicipolitanaFactor;
  else if (edge.k === 1) cost *= profile.roadFactor;
  // I connettori (k === 2) sono tratti brevissimi di raccordo topologico:
  // non vengono ne' favoriti ne' penalizzati.

  /*
   * La pericolosita' non pesa in modo lineare: fra una via di quartiere e una
   * strada di grande traffico, per chi pedala, non c'e' una differenza di
   * grado ma di categoria. Il termine quadratico lascia quasi intatti gli
   * archi tranquilli e rende davvero caro il tratto esposto, invece di
   * scambiarlo volentieri per qualche centinaio di metri risparmiati.
   */
  const danger = 1 - edge.s;
  cost *= 1 + profile.safetyWeight * danger * (1 + DANGER_BOOST * danger);

  if (edge.o?.length) cost += profile.obstaclePenaltySeconds * edge.o.length;
  if (edge.dm) cost += profile.obstaclePenaltySeconds;

  const line = edge.l ?? null;
  if (line !== null && previousLineId !== null && line !== previousLineId) {
    cost += profile.lineChangePenaltySeconds;
  }
  // Uscire dalla Bicipolitana verso la viabilita' ordinaria e' un cambio di
  // contesto reale per chi pedala: viene contato come tale.
  if (line === null && previousLineId !== null && edge.k === 1) {
    cost += profile.lineChangePenaltySeconds * 0.5;
  }

  return cost;
}

/** Velocita' massima teorica usata dall'euristica, in metri al secondo. */
function maxSpeedMetersPerSecond(profile: RoutingProfile, cyclingSpeedKmh: number): number {
  // La Bicipolitana e' l'arco piu' "economico": il costo minimo per metro non
  // puo' scendere sotto questo valore, quindi l'euristica resta ammissibile.
  const bestFactor = Math.min(profile.bicipolitanaFactor, profile.roadFactor, 1);
  return (cyclingSpeedKmh / 3.6) / Math.max(bestFactor, 0.05);
}

export interface AStarOptions {
  profile: RoutingProfile;
  cyclingSpeedKmh: number;
  /** Archi da evitare: usato per generare percorsi alternativi. */
  penalisedEdges?: Set<number>;
  penaltyFactor?: number;
  /** Trattamento delle strade a traffico intenso. */
  busyRoads?: BusyRoadPolicy;
  /**
   * Raggio del margine di uscita attorno ai due capi del viaggio, quando le
   * strade a traffico intenso sono vietate.
   */
  busyEscapeMeters?: number;
  /** Limite di sicurezza sui nodi esplorati. */
  maxVisited?: number;
}

export function findPath(
  index: RoutingGraphView,
  start: number,
  goal: number,
  options: AStarOptions,
): SearchResult | null {
  const { profile, cyclingSpeedKmh } = options;
  const penalised = options.penalisedEdges;
  const penaltyFactor = options.penaltyFactor ?? 3;
  const busyRoads = options.busyRoads;
  const busyEscape = options.busyEscapeMeters ?? BUSY_ROAD_ESCAPE_METERS;
  const maxVisited = options.maxVisited ?? index.nodes.length * 4;

  if (start === goal) return { steps: [], totalCost: 0, visitedNodes: 0 };

  const speed = maxSpeedMetersPerSecond(profile, cyclingSpeedKmh);
  const startPoint: LngLat = index.nodes[start];
  const goalPoint: LngLat = index.nodes[goal];
  const heuristic = (node: number): number => haversine(index.nodes[node], goalPoint) / speed;

  /*
   * Il margine di uscita: una strada vietata resta percorribile solo a ridosso
   * di un capo del viaggio. Serve a chi parte o arriva sulla statale stessa,
   * senza che quel permesso si estenda al resto del percorso — dove la statale
   * non e' la strada di casa di nessuno, e' solo la piu' diretta.
   */
  const nearTerminal = (node: number): boolean =>
    haversine(index.nodes[node], startPoint) <= busyEscape ||
    haversine(index.nodes[node], goalPoint) <= busyEscape;

  const gScore = new Float64Array(index.nodes.length).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(index.nodes.length).fill(-1);
  const cameEdge = new Int32Array(index.nodes.length).fill(-1);
  const cameReversed = new Uint8Array(index.nodes.length);
  const closed = new Uint8Array(index.nodes.length);
  // Linea percorsa per arrivare al nodo: serve a pesare i cambi di linea.
  const lineAt: (string | null)[] = new Array(index.nodes.length).fill(null);

  gScore[start] = 0;
  const open = new MinHeap();
  open.push(heuristic(start), start);
  let visited = 0;

  while (open.size > 0) {
    const popped = open.pop();
    if (!popped) break;
    const current = popped.value;
    if (closed[current]) continue;
    closed[current] = 1;
    visited += 1;

    if (current === goal) {
      const steps: SearchStep[] = [];
      let node = goal;
      while (node !== start) {
        const prev = cameFrom[node];
        const edgeIndex = cameEdge[node];
        if (prev < 0 || edgeIndex < 0) return null;
        steps.push({
          edge: index.edges[edgeIndex],
          from: prev,
          to: node,
          reversed: cameReversed[node] === 1,
        });
        node = prev;
      }
      steps.reverse();
      return { steps, totalCost: gScore[goal], visitedNodes: visited };
    }

    if (visited > maxVisited) break;

    const neighbours: AdjacencyEntry[] = index.adjacency[current];
    for (const entry of neighbours) {
      if (closed[entry.to]) continue;
      const busy = busyRoads !== undefined && isBusyRoad(entry.edge);
      // Vietata vuol dire vietata: l'arco non entra proprio nella ricerca. Lo
      // fa solo se entrambi i suoi estremi stanno a ridosso di un capo del
      // viaggio, cioe' quando e' l'unico modo di entrare in rete o di
      // arrivare a destinazione.
      const escape =
        busy && busyRoads === 'forbid' && nearTerminal(current) && nearTerminal(entry.to);
      if (busy && busyRoads === 'forbid' && !escape) continue;
      let cost = edgeCost(entry.edge, profile, lineAt[current]);
      // Anche dentro il margine la statale resta l'ultima scelta: il permesso
      // serve a poter uscire di casa, non a guadagnare una scorciatoia.
      if (busy && (escape || busyRoads === 'penalise')) cost *= BUSY_ROAD_PENALTY_FACTOR;
      if (penalised?.has(entry.edge.i)) cost *= penaltyFactor;

      const tentative = gScore[current] + cost;
      if (tentative < gScore[entry.to]) {
        gScore[entry.to] = tentative;
        cameFrom[entry.to] = current;
        cameEdge[entry.to] = entry.edge.i;
        cameReversed[entry.to] = entry.reversed ? 1 : 0;
        lineAt[entry.to] = entry.edge.l ?? null;
        open.push(tentative + heuristic(entry.to), entry.to);
      }
    }
  }

  return null;
}
