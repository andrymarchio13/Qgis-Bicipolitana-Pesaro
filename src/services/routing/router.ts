/**
 * Router ciclabile della Bicipolitana.
 *
 * Due livelli, uniti in un solo grafo planarizzato costruito offline:
 *   1. grafo della Bicipolitana;
 *   2. connessioni verso la rete ciclabile/stradale OSM.
 *
 * Il calcolo avviene interamente nel browser: nessuna chiamata di rete, nessuna
 * chiave API, nessun servizio esterno da cui dipendere. Un punto scelto fuori
 * dalla rete non viene rifiutato: viene raccordato al grafo con un tratto a
 * piedi dichiarato, non con un percorso calcolato da un servizio terzo.
 */
import {
  BUSY_ROAD_ESCAPE_LADDER,
  BUSY_ROAD_WARNING_METERS,
  CONNECTOR_RIDE_THRESHOLD_METERS,
  CYCLING_SPEED_KMH,
  DEFAULT_PROFILE_ORDER,
  MAX_ROUTE_ALTERNATIVES,
  ROUTE_ALTERNATIVE_PENALTIES,
  ROUTE_DUPLICATE_THRESHOLD,
  ROUTE_SIMILARITY_THRESHOLD,
  ROUTE_VARIANT_MAX_BUSY_EXCESS_METERS,
  ROUTE_VARIANT_MAX_DETOUR,
  ROUTING_PROFILES,
  WALKING_SPEED_KMH,
  WALK_COLOR,
  WALK_LEG_MIN_METERS,
  WALK_ONLY_MAX_METERS,
  WALK_ONLY_MIN_CONNECTOR_SHARE,
  WALK_ONLY_MIN_DETOUR,
} from '../../config';
import type {
  LightingSpan,
  Line,
  LngLat,
  Route,
  RouteInstruction,
  RouteSegment,
  RouteStep,
  RouteWarning,
  RoutingProfileId,
} from '../../types';
import { summarizeSurfaces } from '../surface';
import { haversine, lineLength } from '../../utils/geo';
import { findPath, type BusyRoadPolicy, type SearchStep } from './astar';
import { attachEndpoints, isWalkEdge } from './attach';
import { busyRoadLabel, isBusyRoad } from './busy';
import type { RoutingGraphIndex } from './graph';
import { buildInstructions, buildSegments } from './instructions';

export class RoutingError extends Error {
  readonly code:
    | 'origin-unreachable'
    | 'destination-unreachable'
    | 'no-path'
    | 'same-point'
    | 'graph-missing';

  constructor(code: RoutingError['code'], message: string) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  destinationLabel?: string | null;
  profiles?: RoutingProfileId[];
  /** Linea da preferire esplicitamente ("Usa questa linea"). */
  preferredLineId?: string | null;
  /**
   * Quanti percorsi restituire al massimo. Il ricalcolo in navigazione ne
   * chiede uno: cercarne altri mentre si pedala e' lavoro buttato.
   */
  maxAlternatives?: number;
}

/** Orienta la geometria dell'arco nel verso di marcia. */
function orientedCoordinates(step: SearchStep): LngLat[] {
  const coords = step.edge.g;
  return step.reversed ? [...coords].reverse() : [...coords];
}

function toRouteSteps(steps: SearchStep[]): RouteStep[] {
  return steps.map((step) => {
    const coordinates = orientedCoordinates(step);
    return {
      edge: step.edge,
      coordinates,
      distanceMeters: step.edge.d,
      durationSeconds: step.edge.t,
    };
  });
}

function assembleGeometry(steps: RouteStep[]): LngLat[] {
  const geometry: LngLat[] = [];
  for (const step of steps) {
    if (geometry.length === 0) geometry.push(...step.coordinates);
    else geometry.push(...step.coordinates.slice(1));
  }
  return geometry;
}

/**
 * Illuminazione dichiarata lungo il percorso, tratto per tratto.
 *
 * I tratti a piedi entrano come "non dichiarato": sono raccordi calcolati per
 * la singola richiesta, non archi dei dati, e nessuno ha mai detto se quella
 * strada abbia i lampioni.
 *
 * Tratti consecutivi con lo stesso stato vengono uniti: quel che interessa
 * e' "due chilometri senza illuminazione dichiarata", non trecento archi.
 */
function collectLighting(
  steps: RouteStep[],
  startWalkSeconds: number,
  startWalkMeters: number,
  endWalkSeconds: number,
  endWalkMeters: number,
): LightingSpan[] {
  const spans: LightingSpan[] = [];
  let elapsed = 0;

  const push = (durationSeconds: number, distanceMeters: number, lit: boolean | null): void => {
    if (durationSeconds <= 0 && distanceMeters <= 0) return;
    const last = spans[spans.length - 1];
    if (last && last.lit === lit) {
      last.durationSeconds += durationSeconds;
      last.distanceMeters += distanceMeters;
    } else {
      spans.push({ fromSeconds: elapsed, durationSeconds, distanceMeters, lit });
    }
    elapsed += durationSeconds;
  };

  push(startWalkSeconds, startWalkMeters, null);
  for (const step of steps) {
    const lit = step.edge.lt === undefined ? null : step.edge.lt === 1;
    push(step.durationSeconds, step.distanceMeters, lit);
  }
  push(endWalkSeconds, endWalkMeters, null);

  return spans;
}

/**
 * Avvisi sul percorso. Riguardano solo cio' che i dati dichiarano davvero
 * lungo la strada — barriere, obbligo di scendere — non la struttura del
 * percorso: il tratto a piedi si spiega da se' con il tratteggio, la sua
 * distanza e la sua istruzione, e non ha bisogno di un avviso.
 */
function collectWarnings(steps: RouteStep[]): RouteWarning[] {
  const warnings: RouteWarning[] = [];
  const blocked = steps.filter((s) => s.edge.bk);
  const dismount = steps.filter((s) => s.edge.dm);
  const obstacles = new Set<string>();
  for (const step of steps) for (const id of step.edge.o ?? []) obstacles.add(id);

  if (blocked.length > 0) {
    warnings.push({
      type: 'blocked',
      message:
        `Il percorso passa vicino a ${blocked.length} ` +
        `${blocked.length === 1 ? 'barriera segnalata' : 'barriere segnalate'} come ` +
        'non transitabili in bicicletta secondo i dati OSM.',
      location: blocked[0].coordinates[0],
    });
  }
  if (dismount.length > 0) {
    warnings.push({
      type: 'dismount',
      message:
        `In ${dismount.length} ${dismount.length === 1 ? 'punto' : 'punti'} i dati ` +
        'segnalano l’obbligo di scendere dalla bicicletta.',
      location: dismount[0].coordinates[0],
    });
  }
  /*
   * Strade a traffico intenso. Il calcolo prova prima a non toccarle affatto,
   * ma nei dati alcune sono l'unico collegamento esistente — un ponte sul
   * Foglia, un tratto di provinciale senza parallele — e in quel caso il
   * percorso ci passa per forza. Dichiararlo e' l'unica risposta onesta: chi
   * pedala decide se accettare quel tratto o cercarne un altro, invece di
   * trovarsi la statale sotto le ruote.
   */
  const busySteps = steps.filter((s) => isBusyRoad(s.edge));
  const busyMeters = busySteps.reduce((sum, s) => sum + s.distanceMeters, 0);
  if (busyMeters >= BUSY_ROAD_WARNING_METERS) {
    // I nomi rendono l'avviso verificabile: senza, resta un'impressione. Il
    // riferimento amministrativo viene prima del nome della via, perche' "SS746"
    // dice a colpo d'occhio di che strada si tratta.
    const nomi = [
      ...new Set(
        busySteps.map((s) => busyRoadLabel(s.edge)).filter((n): n is string => !!n),
      ),
    ];
    const elenco = nomi.slice(0, 2).join(', ');
    const altre = nomi.length > 2 ? ` e altre ${nomi.length - 2}` : '';
    warnings.push({
      type: 'traffico',
      message:
        `Il percorso segue ${Math.round(busyMeters)} m di strade a traffico intenso` +
        (elenco ? ` (${elenco}${altre})` : '') +
        '. Il calcolo le esclude sempre quando esiste un’alternativa: qui, nei ' +
        'dati, non ne esiste nessuna.',
      location: busySteps[0].coordinates[0],
    });
  }

  const remaining = obstacles.size - blocked.length - dismount.length;
  if (remaining > 0) {
    warnings.push({
      type: 'obstacle',
      message:
        obstacles.size === 1
          ? 'Lungo il percorso è presente una barriera ciclabile rilevata nei dati.'
          : `Lungo il percorso sono presenti ${obstacles.size} barriere ciclabili rilevate nei dati.`,
    });
  }
  return warnings;
}

/**
 * Tratto di collegamento a piedi fra il punto scelto dall'utente e il punto in
 * cui il percorso calcolato entra in rete.
 *
 * Quel punto non e' piu' un incrocio: e' la proiezione sulla strada o sulla
 * linea piu' conveniente (vedi `attach.ts`), quindi il collegamento e' il
 * tratto piu' breve che serve davvero, non una camminata fino al primo nodo
 * del grafo. Resta in linea d'aria perche' il progetto non contiene una rete
 * pedonale: se il servizio pedonale opzionale e' attivo, viene ridisegnato
 * sulle strade dopo il calcolo (`walk.ts`).
 */
function walkingLeg(path: LngLat[], streetNames: string[] = []): RouteSegment | null {
  if (path.length < 2) return null;
  const distanceMeters = lineLength(path);
  if (distanceMeters < WALK_LEG_MIN_METERS) return null;
  /*
   * Sotto la soglia il raccordo si fa spingendo la bici — attraversare, uscire
   * da un cortile. Sopra, si pedala: proporre un'ora di cammino a chi ha una
   * bicicletta solo perche' i dati del progetto finiscono prima di casa sua
   * non e' una risposta.
   */
  const transport: 'piedi' | 'bici' =
    distanceMeters > CONNECTOR_RIDE_THRESHOLD_METERS ? 'bici' : 'piedi';
  const speed = transport === 'bici' ? CYCLING_SPEED_KMH : WALKING_SPEED_KMH;
  return {
    lineId: null,
    lineName: null,
    color: WALK_COLOR,
    kind: 'piedi',
    transport,
    distanceMeters,
    durationSeconds: (distanceMeters / 1000 / speed) * 3600,
    coordinates: path,
    streetNames,
  };
}

/** Testo dell'istruzione del raccordo, secondo come lo si percorre. */
const connectorText = (segment: RouteSegment, destinationLabel: string | null): string => {
  if (segment.transport === 'bici') {
    return destinationLabel
      ? `Pedala fino a ${destinationLabel}, fuori dalla rete del progetto`
      : 'Raggiungi in bicicletta l’inizio del percorso ciclabile';
  }
  return destinationLabel
    ? `Prosegui a piedi fino a ${destinationLabel}`
    : 'Raggiungi a piedi l’inizio del percorso ciclabile';
};

/** I due collegamenti a piedi, gia' orientati nel verso di marcia. */
interface WalkLegs {
  start: { path: LngLat[]; streetNames: string[] } | null;
  end: { path: LngLat[]; streetNames: string[] } | null;
}

function buildRoute(
  id: string,
  profileId: RoutingProfileId,
  searchSteps: SearchStep[],
  lines: Map<string, Line>,
  destinationLabel: string | null,
  walkLegs: WalkLegs,
  variant: { index: number } | null = null,
): Route {
  const profile = ROUTING_PROFILES[profileId];
  const steps = toRouteSteps(searchSteps);
  const ridden = assembleGeometry(steps);
  const cyclingSegments = buildSegments(steps, lines, '#16a34a');
  const cyclingInstructions = buildInstructions(steps, cyclingSegments, lines, destinationLabel);

  // I due tratti scoperti diventano segmenti a piedi espliciti.
  const startWalk = walkLegs.start
    ? walkingLeg(walkLegs.start.path, walkLegs.start.streetNames)
    : null;
  const endWalk = walkLegs.end ? walkingLeg(walkLegs.end.path, walkLegs.end.streetNames) : null;

  const segments: RouteSegment[] = [
    ...(startWalk ? [startWalk] : []),
    ...cyclingSegments,
    ...(endWalk ? [endWalk] : []),
  ];

  // La geometria completa unisce i tre pezzi senza ripetere i punti di giunzione.
  const geometry: LngLat[] = [
    ...(startWalk ? startWalk.coordinates.slice(0, -1) : []),
    ...ridden,
    ...(endWalk ? endWalk.coordinates.slice(1) : []),
  ];

  const startWalkMeters = startWalk?.distanceMeters ?? 0;
  const endWalkMeters = endWalk?.distanceMeters ?? 0;
  const walkingMeters = startWalkMeters + endWalkMeters;

  // Le istruzioni della parte in bici scalano della lunghezza del primo
  // tratto a piedi, così le progressive restano coerenti con la geometria.
  const instructions: RouteInstruction[] = [];
  if (startWalk) {
    instructions.push({
      index: 0,
      type: 'walk-start',
      text: connectorText(startWalk, null),
      transport: startWalk.transport,
      distanceMeters: startWalkMeters,
      durationSeconds: startWalk.durationSeconds,
      location: startWalk.coordinates[0],
      lineId: null,
      color: WALK_COLOR,
      streetName: null,
      offsetMeters: 0,
    });
  }
  for (const instruction of cyclingInstructions) {
    instructions.push({
      ...instruction,
      offsetMeters: instruction.offsetMeters + startWalkMeters,
    });
  }
  if (endWalk) {
    // L'arrivo si sposta in fondo, dopo il tratto a piedi.
    const arriveIndex = instructions.findIndex((i) => i.type === 'arrive');
    const arrive = arriveIndex >= 0 ? instructions.splice(arriveIndex, 1)[0] : null;
    instructions.push({
      index: instructions.length,
      type: 'walk-end',
      text: connectorText(endWalk, destinationLabel ?? 'la destinazione'),
      transport: endWalk.transport,
      distanceMeters: endWalkMeters,
      durationSeconds: endWalk.durationSeconds,
      location: endWalk.coordinates[0],
      lineId: null,
      color: WALK_COLOR,
      streetName: null,
      offsetMeters: arrive?.offsetMeters ?? startWalkMeters,
    });
    if (arrive) {
      instructions.push({
        ...arrive,
        distanceMeters: 0,
        location: endWalk.coordinates[endWalk.coordinates.length - 1],
        offsetMeters: arrive.offsetMeters + endWalkMeters,
      });
    }
  }
  instructions.forEach((instruction, index) => {
    instruction.index = index;
  });

  const distanceMeters =
    steps.reduce((sum, s) => sum + s.distanceMeters, 0) + walkingMeters;
  const durationSeconds =
    steps.reduce((sum, s) => sum + s.durationSeconds, 0) +
    (startWalk?.durationSeconds ?? 0) +
    (endWalk?.durationSeconds ?? 0);
  const bicipolitanaMeters = steps
    .filter((s) => s.edge.k === 0)
    .reduce((sum, s) => sum + s.distanceMeters, 0);

  const linesUsed: string[] = [];
  for (const segment of segments) {
    if (segment.lineId && linesUsed[linesUsed.length - 1] !== segment.lineId) {
      linesUsed.push(segment.lineId);
    }
  }

  const obstacleIds = Array.from(
    new Set(steps.flatMap((s) => s.edge.o ?? [])),
  );

  return {
    id,
    profile: profileId,
    // Un percorso nato evitando i tratti gia' proposti non e' "piu' veloce"
    // ne' "piu' tranquillo": dichiararlo con l'etichetta del profilo da cui
    // e' uscito direbbe una cosa falsa su come e' stato scelto.
    profileLabel: variant ? `Alternativa ${variant.index}` : profile.label,
    profileIcon: variant ? '🔀' : profile.icon,
    isVariant: variant !== null,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    geometry,
    segments,
    instructions,
    linesUsed,
    bicipolitanaMeters: Math.round(bicipolitanaMeters),
    walkingMeters: Math.round(walkingMeters),
    bicipolitanaPercentage:
      distanceMeters > 0 ? Math.round((bicipolitanaMeters / distanceMeters) * 100) : 0,
    warnings: collectWarnings(steps),
    obstacleIds,
    surfaces: summarizeSurfaces([
      ...steps.map((s) => ({ surface: s.edge.sf, meters: s.distanceMeters })),
      // I raccordi fuori rete non hanno un fondo dichiarato: entrano fra i
      // metri su cui i dati non dicono nulla, non fra quelli asfaltati.
      { meters: walkingMeters },
    ]),
    lighting: collectLighting(
      steps,
      startWalk?.durationSeconds ?? 0,
      startWalkMeters,
      endWalk?.durationSeconds ?? 0,
      endWalkMeters,
    ),
    durationIsEstimate: true,
  };
}

/**
 * Percorso diretto a piedi fra i due punti, senza passare dalla rete.
 *
 * Serve dove la Bicipolitana non arriva. Il calcolo aggancia comunque i due
 * estremi alla rete coperta dai dati, e fra due punti che stanno entrambi
 * fuori — le frazioni attorno a Pesaro — il giro che ne esce puo' valere il
 * triplo della distanza reale, per toccare poche centinaia di metri di linea.
 * Qui si dice l'altra cosa vera: fra quei due punti si va a piedi, e sono
 * questi metri.
 *
 * Il tratto resta in linea d'aria come tutti i collegamenti fuori rete: se il
 * servizio pedonale opzionale risponde, viene ridisegnato sulle strade dopo il
 * calcolo (`walk.ts`), esattamente come i raccordi.
 */
export function walkOnlyRoute(
  origin: LngLat,
  destination: LngLat,
  destinationLabel: string | null,
): Route | null {
  const coordinates: LngLat[] = [origin, destination];
  const distanceMeters = lineLength(coordinates);
  if (distanceMeters < WALK_LEG_MIN_METERS) return null;
  const durationSeconds = (distanceMeters / 1000 / WALKING_SPEED_KMH) * 3600;

  const segment: RouteSegment = {
    lineId: null,
    lineName: null,
    color: WALK_COLOR,
    kind: 'piedi',
    transport: 'piedi',
    distanceMeters,
    durationSeconds,
    coordinates,
    streetNames: [],
  };

  const instructions: RouteInstruction[] = [
    {
      index: 0,
      type: 'walk-start',
      text: destinationLabel
        ? `Vai a piedi fino a ${destinationLabel}`
        : 'Vai a piedi fino alla destinazione',
      transport: 'piedi',
      distanceMeters,
      durationSeconds,
      location: origin,
      lineId: null,
      color: WALK_COLOR,
      streetName: null,
      offsetMeters: 0,
    },
    {
      index: 1,
      type: 'arrive',
      text: destinationLabel ? `Sei arrivato: ${destinationLabel}` : 'Sei arrivato a destinazione',
      distanceMeters: 0,
      durationSeconds: 0,
      location: destination,
      lineId: null,
      color: WALK_COLOR,
      streetName: null,
      offsetMeters: distanceMeters,
    },
  ];

  return {
    id: 'piedi',
    profile: 'piedi',
    profileLabel: 'A piedi',
    profileIcon: '🚶',
    onFoot: true,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    geometry: coordinates,
    segments: [segment],
    instructions,
    linesUsed: [],
    bicipolitanaMeters: 0,
    walkingMeters: Math.round(distanceMeters),
    bicipolitanaPercentage: 0,
    /*
     * Sotto questo percorso non c'e' nessun arco dei dati: nessun ostacolo
     * dichiarato, nessuna strada trafficata, nessun fondo e nessun lampione di
     * cui il progetto sappia qualcosa. Lasciare gli elenchi vuoti e' l'unica
     * risposta onesta; l'illuminazione entra come "non dichiarata", che e'
     * esattamente cio' che i dati dicono.
     */
    warnings: [],
    obstacleIds: [],
    surfaces: summarizeSurfaces([{ meters: distanceMeters }]),
    lighting: [{ fromSeconds: 0, durationSeconds, distanceMeters, lit: null }],
    durationIsEstimate: true,
  };
}

/**
 * Separa i due collegamenti a piedi dalla parte pedalata.
 *
 * Il cammino e la pedalata escono da un'unica ricerca — e' cosi' che il
 * calcolo puo' preferire venti metri a piedi in piu' per entrare su una linea
 * invece che su una statale — ma nel percorso mostrato sono cose diverse:
 * hanno velocita', colore e istruzioni proprie.
 */
function splitWalkLegs(steps: SearchStep[]): { cycling: SearchStep[]; walk: WalkLegs } {
  const cycling = [...steps];
  const walk: WalkLegs = { start: null, end: null };

  if (cycling.length > 0 && isWalkEdge(cycling[0].edge)) {
    const step = cycling.shift() as SearchStep;
    walk.start = {
      path: orientedCoordinates(step),
      // Il nome della via e' quello del tratto su cui si entra in rete: e'
      // l'informazione che serve a chi cammina ("raggiungi via Tal dei Tali").
      streetNames: cycling[0]?.edge.n ? [cycling[0].edge.n] : [],
    };
  }

  if (cycling.length > 0 && isWalkEdge(cycling[cycling.length - 1].edge)) {
    const step = cycling.pop() as SearchStep;
    walk.end = {
      path: orientedCoordinates(step),
      streetNames: cycling[cycling.length - 1]?.edge.n
        ? [cycling[cycling.length - 1].edge.n as string]
        : [],
    };
  }

  return { cycling, walk };
}

/**
 * Quanto due percorsi si sovrappongono, come frazione di lunghezza in comune.
 *
 * Il confronto va fatto nei due versi e si tiene il valore piu' alto: un
 * percorso breve interamente contenuto in uno lungo condivide il 100% di se'
 * ma solo una parte dell'altro, e mostrarli entrambi sarebbe comunque
 * proporre due volte la stessa strada.
 */
function overlap(a: SearchStep[], b: SearchStep[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const fraction = (from: SearchStep[], to: SearchStep[]): number => {
    const ids = new Set(to.map((s) => s.edge.i));
    let shared = 0;
    let total = 0;
    for (const step of from) {
      total += step.edge.d;
      if (ids.has(step.edge.i)) shared += step.edge.d;
    }
    return total > 0 ? shared / total : 0;
  };
  return Math.max(fraction(a, b), fraction(b, a));
}

/** Metri percorsi su statali, provinciali e grandi arterie. */
function busyMeters(steps: SearchStep[]): number {
  let meters = 0;
  for (const step of steps) {
    if (isBusyRoad(step.edge)) meters += step.edge.d;
  }
  return meters;
}

/** Lunghezza complessiva di un cammino, in metri. */
function pathMeters(steps: SearchStep[]): number {
  let meters = 0;
  for (const step of steps) meters += step.edge.d;
  return meters;
}

export class BicipolitanaRouter {
  constructor(
    private readonly index: RoutingGraphIndex,
    private readonly lines: Map<string, Line>,
  ) {}

  /**
   * Calcola una o piu' alternative fra origine e destinazione.
   * Le alternative troppo simili fra loro vengono scartate.
   */
  route(request: RouteRequest): Route[] {
    const { origin, destination } = request;

    if (haversine(origin, destination) < 30) {
      throw new RoutingError(
        'same-point',
        'Origine e destinazione coincidono: sei già sul posto.',
      );
    }

    /*
     * Il grafo viene ampliato per questa sola richiesta: origine e
     * destinazione si innestano sulla rete nel punto in cui la incontrano, non
     * al primo incrocio utile, e fra piu' innesti possibili sceglie il calcolo
     * del percorso — che vede insieme il cammino e la pedalata.
     */
    const attached = attachEndpoints(this.index, origin, destination);
    if (!attached.ok) {
      throw attached.side === 'origin'
        ? new RoutingError(
            'origin-unreachable',
            'Il punto di partenza è fuori dall’area coperta dai dati del progetto.',
          )
        : new RoutingError(
            'destination-unreachable',
            'La destinazione è fuori dall’area coperta dai dati del progetto.',
          );
    }
    const graph = attached.graph;

    const profileIds = request.profiles ?? DEFAULT_PROFILE_ORDER;
    const maxAlternatives = Math.max(1, request.maxAlternatives ?? MAX_ROUTE_ALTERNATIVES);
    const results: Route[] = [];
    const accepted: SearchStep[][] = [];

    /*
     * "Usa questa linea": le altre linee della Bicipolitana vengono rese meno
     * convenienti, cosi' il calcolo preferisce quella chiesta senza che le
     * altre diventino impossibili.
     */
    const preferred = request.preferredLineId ?? null;
    const preferredPenalty = preferred
      ? graph.edges.filter((e) => e.k === 0 && e.l !== preferred).map((e) => e.i)
      : [];

    /**
     * Un tentativo di ricerca. `avoid` contiene gli archi gia' proposti dagli
     * altri percorsi: non sono vietati, solo resi piu' cari, altrimenti dove
     * la strada e' una sola non si troverebbe piu' nulla.
     */
    const attempt = (
      profileId: RoutingProfileId,
      avoid: Iterable<number>,
      penaltyFactor: number,
      busyRoads: BusyRoadPolicy,
      busyEscapeMeters?: number,
    ): { cycling: SearchStep[]; walk: WalkLegs } | null => {
      const penalisedEdges = new Set<number>([...preferredPenalty, ...avoid]);
      const found = findPath(graph, graph.origin.node, graph.destination.node, {
        profile: { ...ROUTING_PROFILES[profileId] },
        cyclingSpeedKmh: CYCLING_SPEED_KMH,
        penalisedEdges: penalisedEdges.size > 0 ? penalisedEdges : undefined,
        penaltyFactor: penalisedEdges.size > 0 ? penaltyFactor : undefined,
        busyRoads,
        busyEscapeMeters,
      });
      if (!found || found.steps.length === 0) return null;
      const split = splitWalkLegs(found.steps);
      return split.cycling.length > 0 ? split : null;
    };

    /**
     * Ricerca a gradini rispetto alle strade a traffico intenso.
     *
     * La Statale 746 e la Provinciale 423 non sono un itinerario ciclabile, e
     * un progetto che le propone come tale non descrive un percorso che
     * qualcuno farebbe davvero. Quindi si parte dal divieto pieno, e ogni
     * gradino successivo concede il meno possibile:
     *
     *   1. vietate, con il margine di uscita piu' stretto attorno ai due capi;
     *   2. vietate, allargando il margine finche' il percorso non esiste: serve
     *      ai punti che sulla rete ordinaria non hanno nessuno sbocco — a
     *      Chiusa di Ginestreto il nodo del grafo non ha un solo arco che non
     *      sia la SS746 — e tiene comunque la statale confinata ai primi metri,
     *      invece di riaprirla per tutto il viaggio;
     *   3. permesse ovunque a caro prezzo: l'ultima risorsa, quando fra i due
     *      punti non esiste proprio nient'altro. L'avviso lo dichiara.
     */
    const search = (
      profileId: RoutingProfileId,
      avoid: Iterable<number>,
      penaltyFactor: number,
    ): { cycling: SearchStep[]; walk: WalkLegs } | null => {
      for (const margine of BUSY_ROAD_ESCAPE_LADDER) {
        const trovato = attempt(profileId, avoid, penaltyFactor, 'forbid', margine);
        if (trovato) return trovato;
      }
      return attempt(profileId, avoid, penaltyFactor, 'penalise');
    };

    /** Registra un percorso se aggiunge davvero una strada diversa. */
    const accept = (
      profileId: RoutingProfileId,
      candidate: { cycling: SearchStep[]; walk: WalkLegs },
      variant: { index: number } | null,
    ): boolean => {
      const threshold = variant ? ROUTE_SIMILARITY_THRESHOLD : ROUTE_DUPLICATE_THRESHOLD;
      const tooSimilar = accepted.some(
        (other) => overlap(candidate.cycling, other) > threshold,
      );
      if (tooSimilar) return false;

      /*
       * Una variante deve restare lo stesso viaggio per un'altra strada. I
       * profili no: sono i criteri che l'utente ha scelto, e vanno mostrati
       * anche quando costano di piu' — e' il senso di chiedere "il piu'
       * sicuro". Le varianti invece nascono dalla ricerca stessa, e senza un
       * limite continuano a proporne finche' non finiscono le strade: le
       * ultime sono lunghi giri sulla viabilita' a scorrimento, cioe' proprio
       * cio' che l'applicazione dovrebbe evitare.
       */
      if (variant && accepted.length > 0) {
        const migliore = Math.min(...accepted.map(pathMeters));
        if (pathMeters(candidate.cycling) > migliore * ROUTE_VARIANT_MAX_DETOUR) return false;

        const trafficoMigliore = Math.min(...accepted.map(busyMeters));
        if (
          busyMeters(candidate.cycling) >
          trafficoMigliore + ROUTE_VARIANT_MAX_BUSY_EXCESS_METERS
        ) {
          return false;
        }
      }

      accepted.push(candidate.cycling);
      results.push(
        buildRoute(
          variant ? `${profileId}-alt-${variant.index}` : `${profileId}-${results.length}`,
          profileId,
          candidate.cycling,
          this.lines,
          request.destinationLabel ?? null,
          candidate.walk,
          variant,
        ),
      );
      return true;
    };

    // 1. Un percorso per profilo: sono i criteri dichiarati all'utente.
    for (const profileId of profileIds) {
      if (results.length >= maxAlternatives) break;
      const candidate = search(profileId, [], 1.6);
      if (candidate) accept(profileId, candidate, null);
    }

    /*
     * 2. Altre strade per lo stesso viaggio.
     *
     * I profili guardano lo stesso grafo con pesi diversi, ma dove esiste un
     * corridoio evidente ci finiscono tutti: a quel punto l'utente vede un
     * percorso solo e non ha nulla da scegliere. Qui si rifa' la ricerca
     * rendendo piu' cari i tratti gia' proposti — a penalita' crescente,
     * perche' una leggera ritrova quasi la stessa strada e una pesante manda
     * subito troppo lontano — finche' non si raggiunge il numero voluto.
     */
    const usedEdges = new Set<number>();
    for (const path of accepted) for (const step of path) usedEdges.add(step.edge.i);

    for (const penalty of ROUTE_ALTERNATIVE_PENALTIES) {
      if (results.length >= maxAlternatives) break;
      for (const profileId of profileIds) {
        if (results.length >= maxAlternatives) break;
        const candidate = search(profileId, usedEdges, penalty);
        if (!candidate) continue;
        const number = results.filter((r) => r.isVariant).length + 1;
        if (accept(profileId, candidate, { index: number })) {
          for (const step of candidate.cycling) usedEdges.add(step.edge.i);
        }
      }
    }

    if (results.length === 0) {
      throw new RoutingError(
        'no-path',
        'Non è stato trovato un percorso ciclabile fra i due punti con i dati disponibili.',
      );
    }

    /*
     * 3. Andare a piedi, quando la rete obbliga a un giro sproporzionato.
     *
     * Fra due punti fuori dalla rete — le frazioni attorno a Pesaro — il
     * calcolo aggancia comunque la Bicipolitana, e per toccare poche centinaia
     * di metri di linea puo' proporre il triplo della distanza reale. La
     * proposta in bicicletta resta: accanto si mette quella a piedi, con i
     * metri che separano davvero i due punti, e la scelta la fa chi parte.
     *
     * Le tre condizioni delimitano quel caso e nessun altro: i due punti
     * devono essere abbastanza vicini da poterli unire a piedi; il percorso
     * ciclabile deve allungarsi molto piu' della distanza reale; e quel giro
     * deve essere fatto soprattutto di raccordi fuori rete. Un percorso che si
     * allunga restando sulle ciclabili — per evitare una statale, per girare
     * attorno al Foglia — sta facendo il suo mestiere, e non merita che gli si
     * proponga accanto di scendere dalla bicicletta.
     *
     * Non durante la navigazione: li' si chiede un percorso solo, ed e' il
     * ricalcolo di quello che si sta gia' percorrendo. Cambiare mezzo a chi e'
     * in sella perche' ha sbagliato una svolta non e' una risposta.
     */
    if (maxAlternatives > 1) {
      const direct = haversine(origin, destination);
      const migliore = results.reduce((a, b) => (a.distanceMeters <= b.distanceMeters ? a : b));
      const fuoriRete =
        migliore.distanceMeters > 0 ? migliore.walkingMeters / migliore.distanceMeters : 0;
      if (
        direct <= WALK_ONLY_MAX_METERS &&
        migliore.distanceMeters > direct * WALK_ONLY_MIN_DETOUR &&
        fuoriRete >= WALK_ONLY_MIN_CONNECTOR_SHARE
      ) {
        const onFoot = walkOnlyRoute(origin, destination, request.destinationLabel ?? null);
        if (onFoot) results.push(onFoot);
      }
    }

    /*
     * La Bicipolitana resta in cima quando esiste, perche' e' la proposta che
     * il progetto rivendica; dietro si ordina per tempo stimato. Il rango e'
     * calcolato una volta per percorso: un confronto che risponde "prima" a
     * entrambi gli argomenti non e' un ordinamento.
     *
     * Il percorso a piedi entra nello stesso rango: nasce solo dove la rete
     * obbliga a un lungo giro, e li' e' spesso la proposta piu' breve — deve
     * poterlo dimostrare davanti alle altre, non stare in fondo all'elenco.
     */
    const rank = (route: Route): number =>
      route.onFoot || (route.profile === 'bicipolitana' && !route.isVariant) ? 0 : 1;
    results.sort((a, b) => rank(a) - rank(b) || a.durationSeconds - b.durationSeconds);

    // Il numero massimo di proposte vale anche quando fra queste c'e' quella a
    // piedi: e' una possibilita' in piu' da valutare, non un permesso di
    // allungare l'elenco.
    return results.slice(0, maxAlternatives);
  }

  /** Ricalcolo durante la navigazione: mantiene il profilo in uso. */
  reroute(current: LngLat, destination: LngLat, profile: RoutingProfileId | 'piedi',
    destinationLabel: string | null): Route | null {
    // Chi sta camminando continua a camminare: il percorso a piedi non passa
    // dal grafo ciclabile, e ricalcolarlo e' ridisegnare la linea dal punto in
    // cui ci si trova.
    if (profile === 'piedi') return walkOnlyRoute(current, destination, destinationLabel);
    try {
      const routes = this.route({
        origin: current,
        destination,
        destinationLabel,
        profiles: [profile],
        maxAlternatives: 1,
      });
      return routes[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Lunghezza reale della geometria calcolata, per i test di coerenza. */
  static geometryLength(route: Route): number {
    return lineLength(route.geometry);
  }
}
