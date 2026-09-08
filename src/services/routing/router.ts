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
  CONNECTOR_RIDE_THRESHOLD_METERS,
  CYCLING_SPEED_KMH,
  ROUTING_PROFILES,
  WALKING_SPEED_KMH,
  WALK_COLOR,
  WALK_LEG_MIN_METERS,
} from '../../config';
import type {
  Line,
  LngLat,
  Route,
  RouteInstruction,
  RouteSegment,
  RouteStep,
  RouteWarning,
  RoutingProfileId,
} from '../../types';
import { haversine, lineLength } from '../../utils/geo';
import { findPath, type SearchStep } from './astar';
import { attachEndpoints, isWalkEdge } from './attach';
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
    profileLabel: profile.label,
    profileIcon: profile.icon,
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

/** Due percorsi sono considerati equivalenti se condividono quasi tutti gli archi. */
function similarity(a: SearchStep[], b: SearchStep[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map((s) => s.edge.i));
  let shared = 0;
  let total = 0;
  for (const step of a) {
    total += step.edge.d;
    if (setB.has(step.edge.i)) shared += step.edge.d;
  }
  return total > 0 ? shared / total : 0;
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

    const profileIds = request.profiles ?? ['bicipolitana', 'fast', 'quiet'];
    const results: Route[] = [];
    const accepted: SearchStep[][] = [];

    for (const profileId of profileIds) {
      const profile = { ...ROUTING_PROFILES[profileId] };

      // "Usa questa linea": la linea scelta viene resa ancora piu' conveniente.
      const preferred = request.preferredLineId ?? null;
      const found = findPath(graph, graph.origin.node, graph.destination.node, {
        profile,
        cyclingSpeedKmh: CYCLING_SPEED_KMH,
        penalisedEdges: preferred
          ? new Set(
              graph.edges.filter((e) => e.k === 0 && e.l !== preferred).map((e) => e.i),
            )
          : undefined,
        penaltyFactor: preferred ? 1.6 : undefined,
      });

      if (!found || found.steps.length === 0) continue;

      const { cycling, walk } = splitWalkLegs(found.steps);
      if (cycling.length === 0) continue;

      const isDuplicate = accepted.some((other) => similarity(cycling, other) > 0.9);
      if (isDuplicate) continue;

      accepted.push(cycling);
      results.push(
        buildRoute(
          `${profileId}-${results.length}`,
          profileId,
          cycling,
          this.lines,
          request.destinationLabel ?? null,
          walk,
        ),
      );
    }

    if (results.length === 0) {
      throw new RoutingError(
        'no-path',
        'Non è stato trovato un percorso ciclabile fra i due punti con i dati disponibili.',
      );
    }

    // La Bicipolitana resta in cima quando esiste; poi si ordina per tempo.
    results.sort((a, b) => {
      if (a.profile === 'bicipolitana') return -1;
      if (b.profile === 'bicipolitana') return 1;
      return a.durationSeconds - b.durationSeconds;
    });

    return results;
  }

  /** Ricalcolo durante la navigazione: mantiene il profilo in uso. */
  reroute(current: LngLat, destination: LngLat, profile: RoutingProfileId,
    destinationLabel: string | null): Route | null {
    try {
      const routes = this.route({
        origin: current,
        destination,
        destinationLabel,
        profiles: [profile],
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
