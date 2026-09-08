/**
 * Innesto di origine e destinazione sulla rete.
 *
 * Il grafo caricato dal file ha nodi solo agli incroci: un percorso calcolato
 * su di esso puo' partire soltanto da un incrocio. Ma chi chiede un percorso si
 * trova quasi sempre a meta' strada fra due incroci, e fargli raggiungere
 * l'incrocio successivo a piedi puo' significare centinaia di metri di cammino
 * lungo una strada che ha di fianco — o, in campagna, chilometri.
 *
 * Qui il grafo viene ampliato **per la singola richiesta**: nei punti di
 * innesto si aggiungono nodi che spezzano l'arco, e un nodo terminale
 * collegato a tutti gli innesti candidati da archi a piedi. Il calcolo del
 * percorso sceglie da solo dove conviene entrare in rete, valutando insieme il
 * cammino e la pedalata che ne segue: e' cosi' che un innesto venti metri piu'
 * lontano ma sulla Bicipolitana puo' vincere su uno piu' vicino ma su una
 * statale.
 *
 * L'indice originale non viene mai modificato: le adiacenze toccate vengono
 * copiate prima di aggiungerci qualcosa.
 */
import {
  SNAP_MAX_DISTANCE_METERS,
  WALKING_SPEED_KMH,
  WALK_COST_FACTOR,
  WALK_SAFETY_WEIGHT,
  WALK_SNAP_MAX_DISTANCE_METERS,
} from '../../config';
import type { GraphEdge, LngLat } from '../../types';
import { haversine, lineLength, sliceLine } from '../../utils/geo';
import type {
  AdjacencyEntry,
  Attachment,
  RoutingGraphIndex,
  RoutingGraphView,
} from './graph';

/** Un arco creato per collegare a piedi il punto scelto alla rete. */
export const isWalkEdge = (edge: GraphEdge): boolean => edge.vw === 1;

export interface AttachedTerminal {
  /** Nodo da cui parte (o a cui arriva) la ricerca. */
  node: number;
  /** Innesti candidati, nell'ordine in cui sono stati valutati. */
  attachments: Attachment[];
}

export interface AttachedGraph extends RoutingGraphView {
  origin: AttachedTerminal;
  destination: AttachedTerminal;
}

export type AttachResult =
  | { ok: true; graph: AttachedGraph }
  /** Quale dei due punti non ha rete raggiungibile: il messaggio lo dira'. */
  | { ok: false; side: 'origin' | 'destination' };

/** Quanti innesti proporre al calcolo del percorso. */
const ATTACH_CANDIDATES = 8;

/**
 * Margine entro cui un innesto piu' lontano resta in gara.
 *
 * Serve a poter scartare l'aggancio piu' vicino quando e' su una strada che a
 * piedi non si percorre volentieri: la ciclabile dietro l'isolato vale i cento
 * metri in piu'. Non e' un permesso di camminare a piacere — oltre questo
 * margine gli innesti non vengono nemmeno considerati, e dentro il margine
 * decide il costo, che il cammino lo paga caro.
 */
const ATTACH_TOLERANCE_METERS = 150;

/** Sotto questa distanza l'innesto coincide con un nodo gia' esistente. */
const ENDPOINT_EPSILON_METERS = 0.5;

/**
 * Innesti utili per un punto.
 *
 * Prima si guarda vicino: se la rete e' a portata, il collegamento a piedi non
 * deve esistere affatto. Solo quando non c'e' niente entro quel raggio si
 * allarga la ricerca, e allora il tratto scoperto diventa un cammino
 * dichiarato.
 */
export function attachmentsFor(index: RoutingGraphIndex, point: LngLat): Attachment[] {
  const near = index.attachments(point, SNAP_MAX_DISTANCE_METERS, ATTACH_CANDIDATES);
  const found =
    near.length > 0
      ? near
      : index.attachments(point, WALK_SNAP_MAX_DISTANCE_METERS, ATTACH_CANDIDATES);
  if (found.length === 0) return [];
  const limit = found[0].offNetworkMeters + ATTACH_TOLERANCE_METERS;
  return found.filter((attachment) => attachment.offNetworkMeters <= limit);
}

/**
 * Costruisce il grafo ampliato con gli innesti dei due estremi.
 *
 * `maxDistanceMeters` limita quanto lontano si puo' cercare la rete: oltre
 * quella soglia il punto e' semplicemente fuori dall'area coperta dai dati, e
 * proporre un percorso significherebbe proporre una camminata che nessuno
 * farebbe.
 */
export function attachEndpoints(
  index: RoutingGraphIndex,
  origin: LngLat,
  destination: LngLat,
): AttachResult {
  const originAttachments = attachmentsFor(index, origin);
  if (originAttachments.length === 0) return { ok: false, side: 'origin' };
  const destinationAttachments = attachmentsFor(index, destination);
  if (destinationAttachments.length === 0) return { ok: false, side: 'destination' };

  const nodes = [...index.nodes];
  const edges = [...index.edges];
  const adjacency = index.adjacency.slice();
  // Le liste di adiacenza dell'indice sono condivise: si copiano solo quelle
  // che questa richiesta modifica davvero.
  const copied = new Set<number>();
  const neighboursOf = (node: number): AdjacencyEntry[] => {
    if (!copied.has(node)) {
      adjacency[node] = (adjacency[node] ?? []).slice();
      copied.add(node);
    }
    return adjacency[node];
  };

  const addNode = (point: LngLat): number => {
    nodes.push(point);
    adjacency.push([]);
    copied.add(nodes.length - 1);
    return nodes.length - 1;
  };

  const addEdge = (edge: GraphEdge, forward: boolean, backward: boolean): void => {
    edge.i = edges.length;
    edges.push(edge);
    if (forward) neighboursOf(edge.a).push({ to: edge.b, edge, reversed: false });
    if (backward) neighboursOf(edge.b).push({ to: edge.a, edge, reversed: true });
  };

  /** Spezza l'arco nel punto di innesto, conservandone tutti gli attributi. */
  const splitAt = (attachment: Attachment): number => {
    const { edge } = attachment;
    const total = lineLength(edge.g);

    /*
     * Se l'innesto cade su un estremo dell'arco, il nodo esiste gia'. Crearne
     * un altro nello stesso punto produrrebbe un doppione isolato: uno dei due
     * tronconi avrebbe lunghezza nulla e non verrebbe aggiunto, lasciando il
     * nuovo nodo collegato da una parte sola. E' esattamente il caso di chi
     * chiede un percorso stando su un incrocio.
     */
    if (attachment.offsetMeters <= ENDPOINT_EPSILON_METERS) return edge.a;
    if (attachment.offsetMeters >= total - ENDPOINT_EPSILON_METERS) return edge.b;

    const node = addNode(attachment.point);

    const piece = (from: number, to: number, a: number, b: number): void => {
      const geometry = sliceLine(edge.g, from, to);
      if (geometry.length < 2) return;
      const meters = lineLength(geometry);
      addEdge(
        {
          ...edge,
          a,
          b,
          d: meters,
          // Il tempo resta proporzionale: la velocita' stimata sull'arco non
          // cambia perche' lo si percorre a meta'.
          t: total > 0 ? (edge.t * meters) / total : edge.t,
          g: geometry,
        },
        edge.ow !== -1,
        edge.ow !== 1,
      );
    };

    // I due tronconi mantengono il verso dell'arco originale: il senso unico
    // continua a valere anche dopo la divisione.
    piece(0, attachment.offsetMeters, edge.a, node);
    piece(attachment.offsetMeters, total, node, edge.b);
    return node;
  };

  const buildTerminal = (point: LngLat, attachments: Attachment[]): AttachedTerminal => {
    const terminal = addNode(point);
    const joined = new Set<number>();
    for (const attachment of attachments) {
      const joint = splitAt(attachment);
      // Due archi che si incontrano nello stesso incrocio danno lo stesso
      // nodo: un secondo collegamento a piedi identico non aggiunge nulla.
      if (joined.has(joint)) continue;
      joined.add(joint);
      // La distanza e' quella dal punto scelto al nodo effettivo: quando
      // l'innesto e' stato ricondotto a un incrocio, la proiezione non e' piu'
      // il punto in cui si entra in rete.
      const meters = haversine(point, nodes[joint]);
      const seconds = (meters / 1000 / WALKING_SPEED_KMH) * 3600;
      /*
       * Non tutti i metri a piedi sono uguali. Raggiungere una strada a
       * scorrimento significa camminare sul ciglio di una carreggiata veloce,
       * e poi immettersi in bicicletta proprio li'; arrivare a una ciclabile o
       * a una strada residenziale no. Il punteggio di sicurezza dell'arco su
       * cui ci si innesta — euristico e dichiarato, come tutti quelli del
       * progetto — moltiplica il costo del cammino, cosi' un innesto un po'
       * piu' lontano ma su una via tranquilla puo' battere quello davanti a
       * casa su una statale.
       */
      const exposure = 1 + WALK_SAFETY_WEIGHT * (1 - attachment.edge.s);
      addEdge(
        {
          i: -1,
          a: terminal,
          b: joint,
          d: meters,
          /*
           * Il costo del cammino e' il suo tempo, maggiorato: spingere la bici
           * a piedi e' peggio che pedalare anche a parita' di minuti, e senza
           * questa maggiorazione il calcolo accetterebbe volentieri qualche
           * centinaio di metri a piedi per risparmiare una curva.
           */
          t: Math.max(0.1, seconds * WALK_COST_FACTOR * exposure),
          k: 2,
          s: 1,
          g: [point, nodes[joint]],
          vw: 1,
        },
        true,
        true,
      );
    }
    return { node: terminal, attachments };
  };

  const originTerminal = buildTerminal(origin, originAttachments);
  const destinationTerminal = buildTerminal(destination, destinationAttachments);

  return {
    ok: true,
    graph: {
      nodes,
      edges,
      adjacency,
      origin: originTerminal,
      destination: destinationTerminal,
    },
  };
}
