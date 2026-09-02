/**
 * Indice del grafo di routing.
 *
 * Il grafo viene generato offline da `scripts/build-routing-graph.py` a partire
 * dai dati GIS originali. Qui viene solo indicizzato per la ricerca del
 * percorso e per l'aggancio di origine/destinazione.
 */
import type { GraphEdge, LngLat, RoutingGraph } from '../../types';
import { haversine, projectOnLine } from '../../utils/geo';

export interface AdjacencyEntry {
  /** Nodo di arrivo. */
  to: number;
  edge: GraphEdge;
  /** true se l'arco viene percorso dal nodo `b` verso il nodo `a`. */
  reversed: boolean;
}

/** Nodo del grafo piu' vicino a un punto, con la distanza in metri. */
export interface SnapResult {
  /** Nodo da cui parte (o a cui arriva) il percorso calcolato. */
  nodeId: number;
  /**
   * Distanza in linea d'aria fino a `nodeId`: e' il tratto che l'utente
   * percorre davvero a piedi, non la distanza dall'arco piu' vicino.
   */
  distanceMeters: number;
  /** Proiezione del punto sull'arco piu' vicino, per usi cartografici. */
  point: LngLat;
  /** Arco su cui e' avvenuto l'aggancio, se noto. */
  edge: GraphEdge | null;
}

const CELL_DEGREES = 0.004; // ~330 m di lato alla latitudine di Pesaro

/**
 * Anelli di celle esplorabili attorno a un punto: ~13 km di raggio. Basta a
 * coprire i punti scelti fuori Pesaro, che vengono collegati alla rete con un
 * tratto a piedi invece di essere rifiutati.
 */
const MAX_SEARCH_RINGS = 40;

export class RoutingGraphIndex {
  readonly raw: RoutingGraph;

  readonly nodes: LngLat[];

  readonly edges: GraphEdge[];

  /** Liste di adiacenza rispettose dei sensi unici per la bicicletta. */
  readonly adjacency: AdjacencyEntry[][];

  /** Griglia spaziale nodo -> cella, per la ricerca del nodo piu' vicino. */
  private readonly nodeGrid = new Map<string, number[]>();

  /** Griglia spaziale arco -> celle attraversate. */
  private readonly edgeGrid = new Map<string, number[]>();

  constructor(graph: RoutingGraph) {
    this.raw = graph;
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.adjacency = Array.from({ length: graph.nodes.length }, () => []);

    // L'identificatore dell'arco deve coincidere con la sua posizione
    // nell'array: il percorso viene ricostruito per indice.
    graph.edges.forEach((edge, position) => {
      if (edge.i !== position) edge.i = position;
    });

    for (const edge of graph.edges) {
      const forward = edge.ow !== -1;
      const backward = edge.ow !== 1;
      if (forward) this.adjacency[edge.a].push({ to: edge.b, edge, reversed: false });
      if (backward) this.adjacency[edge.b].push({ to: edge.a, edge, reversed: true });
    }

    graph.nodes.forEach((node, index) => {
      const key = RoutingGraphIndex.cellKey(node[0], node[1]);
      const bucket = this.nodeGrid.get(key);
      if (bucket) bucket.push(index);
      else this.nodeGrid.set(key, [index]);
    });

    graph.edges.forEach((edge, index) => {
      const cells = new Set<string>();
      for (const [lng, lat] of edge.g) cells.add(RoutingGraphIndex.cellKey(lng, lat));
      for (const key of cells) {
        const bucket = this.edgeGrid.get(key);
        if (bucket) bucket.push(index);
        else this.edgeGrid.set(key, [index]);
      }
    });
  }

  private static cellKey(lng: number, lat: number): string {
    return `${Math.floor(lng / CELL_DEGREES)}:${Math.floor(lat / CELL_DEGREES)}`;
  }

  private *cellsAround(lng: number, lat: number, ring: number): Generator<string> {
    const cx = Math.floor(lng / CELL_DEGREES);
    const cy = Math.floor(lat / CELL_DEGREES);
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        yield `${cx + dx}:${cy + dy}`;
      }
    }
  }

  /**
   * Aggancia un punto al grafo. Espande la ricerca ad anelli concentrici
   * finche' non trova un candidato o supera `maxDistanceMeters`.
   *
   * Due misure distinte, che vanno tenute separate:
   *   - la proiezione sull'arco dice *quanto il punto e' vicino alla rete*, ed
   *     e' il criterio giusto per scegliere l'arco piu' vicino;
   *   - il percorso pero' parte da un **nodo**, non dalla proiezione, quindi il
   *     tratto che l'utente percorre davvero e' quello fino al nodo.
   *
   * `distanceMeters` riporta la seconda: e' la distanza che viene disegnata
   * come collegamento a piedi e conteggiata nel totale, e dichiararne un'altra
   * significherebbe mostrare un numero che non corrisponde alla linea tracciata.
   * Fra le estremita' si sceglie quindi la piu' vicina al punto, non quella con
   * l'offset minore lungo l'arco.
   */
  snap(point: LngLat, maxDistanceMeters: number): SnapResult | null {
    let bestEdge: { edge: GraphEdge; projection: ReturnType<typeof projectOnLine> } | undefined;
    let bestEdgeDistance = Number.POSITIVE_INFINITY;
    let bestNodeId = -1;
    let bestNodeDistance = Number.POSITIVE_INFINITY;
    const maxRing = Math.min(MAX_SEARCH_RINGS, Math.ceil(maxDistanceMeters / 330) + 1);

    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (const key of this.cellsAround(point[0], point[1], ring)) {
        for (const edgeIndex of this.edgeGrid.get(key) ?? []) {
          const edge = this.edges[edgeIndex];

          // Estremita' raggiungibili a piedi: si tiene la piu' vicina in assoluto.
          for (const nodeId of [edge.a, edge.b]) {
            const distance = haversine(point, this.nodes[nodeId]);
            if (distance < bestNodeDistance) {
              bestNodeDistance = distance;
              bestNodeId = nodeId;
            }
          }

          const projection = projectOnLine(point, edge.g);
          if (projection.distanceMeters < bestEdgeDistance) {
            bestEdgeDistance = projection.distanceMeters;
            bestEdge = { edge, projection };
          }
        }
      }
      // Ci si ferma solo quando entrambe le misure sono gia' dentro il raggio
      // esplorato: un anello piu' esterno non puo' piu' migliorarle.
      const explored = ring * 330;
      if (bestEdgeDistance <= explored && bestNodeDistance <= explored) break;
    }

    if (bestNodeId < 0 || bestNodeDistance > maxDistanceMeters) return null;
    return {
      nodeId: bestNodeId,
      distanceMeters: bestNodeDistance,
      point: bestEdge?.projection.point ?? this.nodes[bestNodeId],
      edge: bestEdge?.edge ?? null,
    };
  }

  /** Nodo del grafo piu' vicino, ignorando la geometria degli archi. */
  nearestNode(point: LngLat, maxDistanceMeters: number): SnapResult | null {
    let best: SnapResult | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    const maxRing = Math.min(MAX_SEARCH_RINGS, Math.ceil(maxDistanceMeters / 330) + 1);
    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (const key of this.cellsAround(point[0], point[1], ring)) {
        for (const nodeId of this.nodeGrid.get(key) ?? []) {
          const d = haversine(point, this.nodes[nodeId]);
          if (d < bestDistance) {
            bestDistance = d;
            best = { nodeId, distanceMeters: d, point: this.nodes[nodeId], edge: null };
          }
        }
      }
      if (bestDistance <= ring * 330) break;
    }
    if (!best || bestDistance > maxDistanceMeters) return null;
    return best;
  }

  /** Archi appartenenti a una linea della Bicipolitana. */
  edgesOfLine(lineId: string): GraphEdge[] {
    return this.edges.filter((e) => e.l === lineId);
  }
}
