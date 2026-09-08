/**
 * Indice del grafo di routing.
 *
 * Il grafo viene generato offline da `scripts/build-routing-graph.py` a partire
 * dai dati GIS originali. Qui viene solo indicizzato per la ricerca del
 * percorso e per l'aggancio di origine/destinazione.
 */
import type { GraphEdge, LngLat, RoutingGraph } from '../../types';
import { haversine, lineLength, projectOnLine, sliceLine } from '../../utils/geo';

/**
 * Cio' che serve alla ricerca del percorso: nodi, archi e adiacenze.
 *
 * E' un'interfaccia e non la classe perche' la ricerca lavora anche su un
 * grafo *ampliato* per una singola richiesta — con gli agganci di origine e
 * destinazione a meta' arco — che non e' l'indice caricato dal file e non deve
 * poterlo modificare.
 */
export interface RoutingGraphView {
  nodes: LngLat[];
  edges: GraphEdge[];
  adjacency: AdjacencyEntry[][];
}

/** Punto in cui un percorso puo' innestarsi sulla rete. */
export interface Attachment {
  edge: GraphEdge;
  /** Proiezione del punto scelto sull'arco: e' li' che si entra in rete. */
  point: LngLat;
  /** Progressiva della proiezione lungo l'arco, in metri. */
  offsetMeters: number;
  /** Distanza dal punto scelto alla rete, in linea d'aria. */
  offNetworkMeters: number;
}

export interface AdjacencyEntry {
  /** Nodo di arrivo. */
  to: number;
  edge: GraphEdge;
  /** true se l'arco viene percorso dal nodo `b` verso il nodo `a`. */
  reversed: boolean;
}

/** Aggancio di un punto alla rete, con il tratto a piedi che lo raccorda. */
export interface SnapResult {
  /** Nodo da cui parte (o a cui arriva) il percorso calcolato. */
  nodeId: number;
  /**
   * Lunghezza del tratto a piedi fino a `nodeId`: e' la lunghezza di
   * `walkPath`, cioe' esattamente il tratto che viene disegnato.
   */
  distanceMeters: number;
  /**
   * Percorso a piedi dal punto scelto fino al nodo. Segue la geometria della
   * strada su cui il punto si aggancia; solo il primo tratto — dal punto alla
   * strada — e' in linea d'aria, perche' li' i dati non dicono altro.
   */
  walkPath: LngLat[];
  /** Proiezione del punto sull'arco piu' vicino, per usi cartografici. */
  point: LngLat;
  /** Distanza in linea d'aria dal punto alla rete: la parte non coperta dai dati. */
  offNetworkMeters: number;
  /** Arco su cui e' avvenuto l'aggancio, se noto. */
  edge: GraphEdge | null;
}

const CELL_DEGREES = 0.004; // ~330 m di lato alla latitudine di Pesaro

/**
 * Limite di sicurezza sugli anelli di celle esplorabili attorno a un punto:
 * ~66 km di raggio.
 *
 * Non e' la distanza massima di aggancio — quella la decide chi chiama — ma
 * solo la garanzia che una ricerca da un punto assurdo (un'altra regione, una
 * coordinata sbagliata) finisca invece di scandire la griglia all'infinito.
 */
const MAX_SEARCH_RINGS = 200;

/**
 * Quanto "costa" un metro fuori dalla rete rispetto a un metro su strada.
 *
 * Fuori dalle strade note i dati non dicono nulla: quel tratto puo' essere un
 * campo, un recinto o un fiume, e viene comunque disegnato in linea d'aria.
 * Trattarlo come un metro qualsiasi porterebbe a preferire una scorciatoia di
 * un chilometro attraverso la campagna a un cammino un po' piu' lungo lungo la
 * strada su cui l'utente si trova davvero. Il fattore serve solo a scegliere
 * l'aggancio: la distanza dichiarata resta quella effettiva del tratto.
 */
const OFF_NETWORK_PENALTY = 4;

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
   * Aggancia un punto a un **nodo** del grafo, con il cammino che ci porta.
   *
   * Non e' piu' il modo in cui si costruiscono i percorsi: quelli si innestano
   * a meta' arco (vedi `attachments()` e `attach.ts`), perche' obbligare a
   * raggiungere un incrocio significa far camminare per centinaia di metri chi
   * si trova gia' sulla strada giusta. Resta come misura di riferimento —
   * "quanto dista il nodo utile" — nei controlli sui dati.
   *
   * Espande la ricerca ad anelli concentrici finche' non trova un candidato o
   * supera `maxDistanceMeters`.
   *
   * Il percorso calcolato parte da un **nodo**, mentre l'utente si trova quasi
   * sempre a meta' di un arco: fra i due punti resta un tratto da fare a piedi.
   * Quel tratto non viene disegnato in linea d'aria, perche' taglierebbe
   * campi ed edifici mostrando un passaggio che non esiste: si percorre la
   * geometria della strada su cui il punto si aggancia, e resta in linea d'aria
   * solo il raccordo fino alla strada, dove i dati non dicono altro.
   *
   * Di conseguenza fra le due estremita' dell'arco si sceglie quella che si
   * raggiunge con il cammino piu' breve *lungo la strada*, non quella piu'
   * vicina in linea d'aria: e' quella che l'utente percorrerebbe davvero.
   * `distanceMeters` e' la lunghezza di `walkPath`, cioe' esattamente il
   * tratto disegnato: dichiarare un numero diverso significherebbe mostrare
   * una distanza che non corrisponde alla linea tracciata.
   */
  snap(point: LngLat, maxDistanceMeters: number): SnapResult | null {
    let best: SnapResult | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    const maxRing = Math.min(MAX_SEARCH_RINGS, Math.ceil(maxDistanceMeters / 330) + 1);

    const considera = (edge: GraphEdge): void => {
      const projection = projectOnLine(point, edge.g);
      const total = lineLength(edge.g);

      // Le due estremita' dell'arco, raggiunte camminando lungo la strada.
      const candidati: { nodeId: number; road: LngLat[] }[] = [
        { nodeId: edge.a, road: sliceLine(edge.g, projection.offsetMeters, 0) },
        { nodeId: edge.b, road: sliceLine(edge.g, projection.offsetMeters, total) },
      ];

      for (const candidato of candidati) {
        const walkPath = [point, ...candidato.road];
        const distanceMeters = lineLength(walkPath);
        const cost =
          projection.distanceMeters * OFF_NETWORK_PENALTY +
          (distanceMeters - projection.distanceMeters);
        if (cost >= bestCost) continue;
        bestCost = cost;
        best = {
          nodeId: candidato.nodeId,
          distanceMeters,
          walkPath,
          point: projection.point,
          offNetworkMeters: projection.distanceMeters,
          edge,
        };
      }
    };

    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (const key of this.cellsAround(point[0], point[1], ring)) {
        for (const edgeIndex of this.edgeGrid.get(key) ?? []) considera(this.edges[edgeIndex]);
      }
      // Un arco trovato in un anello piu' esterno dista almeno quanto quello
      // gia' esplorato, quindi costa gia' di piu': si puo' smettere.
      if (bestCost <= ring * 330) break;
    }

    if (!best || best.distanceMeters > maxDistanceMeters) return null;
    return best;
  }

  /**
   * Punti in cui conviene innestarsi sulla rete, dal piu' vicino.
   *
   * A differenza di `snap()` non sceglie un nodo: restituisce la proiezione
   * sull'arco, cioe' il punto in cui si arriva davvero camminando in linea
   * retta verso la rete. Il nodo piu' vicino puo' essere molto piu' lontano —
   * su una strada di campagna l'incrocio successivo e' a centinaia di metri —
   * e obbligare a raggiungerlo significa far camminare l'utente lungo tutta la
   * strada invece che attraversarla.
   *
   * Ne restituisce piu' d'uno perche' la scelta migliore non e' sempre la piu'
   * vicina: entrare venti metri piu' in la' su una linea della Bicipolitana
   * puo' valere molto piu' di venti metri risparmiati a piedi. A decidere e'
   * il calcolo del percorso, che li valuta tutti insieme.
   */
  attachments(point: LngLat, maxDistanceMeters: number, limit = 8): Attachment[] {
    const found = new Map<number, Attachment>();
    const maxRing = Math.min(MAX_SEARCH_RINGS, Math.ceil(maxDistanceMeters / 330) + 1);
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (const key of this.cellsAround(point[0], point[1], ring)) {
        for (const edgeIndex of this.edgeGrid.get(key) ?? []) {
          if (found.has(edgeIndex)) continue;
          const edge = this.edges[edgeIndex];
          const projection = projectOnLine(point, edge.g);
          if (projection.distanceMeters > maxDistanceMeters) continue;
          if (projection.distanceMeters < bestDistance) bestDistance = projection.distanceMeters;
          found.set(edgeIndex, {
            edge,
            point: projection.point,
            offsetMeters: projection.offsetMeters,
            offNetworkMeters: projection.distanceMeters,
          });
        }
      }
      // Un anello piu' esterno non puo' contenere archi piu' vicini di quelli
      // gia' trovati: quando ne abbiamo abbastanza si puo' smettere.
      if (found.size >= limit && bestDistance <= ring * 330) break;
    }

    return [...found.values()]
      .sort((a, b) => a.offNetworkMeters - b.offNetworkMeters)
      .slice(0, limit);
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
            best = {
            nodeId,
            distanceMeters: d,
            walkPath: [point, this.nodes[nodeId]],
            point: this.nodes[nodeId],
            offNetworkMeters: d,
            edge: null,
          };
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
