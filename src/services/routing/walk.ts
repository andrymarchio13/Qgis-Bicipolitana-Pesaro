/**
 * Rifinitura dei raccordi fuori rete su strade reali.
 *
 * Il router del progetto lavora offline sul grafo costruito dai dati GIS di
 * Pesaro. Quel grafo copre la Bicipolitana e la viabilita' del comune: quando
 * il punto scelto (o la posizione GPS) cade fuori da quella copertura, il
 * collegamento fino alla rete resta per forza in linea d'aria, e sulla mappa
 * attraversa campi ed edifici.
 *
 * Qui quel solo tratto viene ricalcolato su OSM completo (Valhalla pubblico di
 * OpenStreetMap), con il mezzo che il raccordo dichiara: a piedi se sono poche
 * decine di metri, in bicicletta se sono chilometri. E' l'unica chiamata di
 * rete del calcolo, e' facoltativa e fallisce in silenzio: se il servizio non
 * risponde il percorso resta esattamente quello calcolato offline, con il
 * tratto in linea d'aria di prima. Nessun dato oltre le due coordinate del
 * collegamento lascia il dispositivo.
 */
import {
  CYCLING_SPEED_KMH,
  WALKING_SPEED_KMH,
  WALK_ROUTING_MAX_DETOUR,
  WALK_ROUTING_MIN_METERS,
  WALK_ROUTING_TIMEOUT_MS,
  WALK_ROUTING_URL,
} from '../../config';
import type { LngLat, Route, RouteSegment } from '../../types';
import { haversine, lineLength } from '../../utils/geo';

/** Il servizio restituisce la geometria come polyline con 6 decimali. */
function decodePolyline6(encoded: string): LngLat[] {
  const coords: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

/**
 * Percorso pedonale fra due punti, o `null` se il servizio non e' configurato,
 * non risponde, o restituisce qualcosa di inatteso.
 */
export async function walkingPath(
  from: LngLat,
  to: LngLat,
  transport: 'piedi' | 'bici' = 'piedi',
): Promise<LngLat[] | null> {
  if (!WALK_ROUTING_URL) return null;
  if (haversine(from, to) < WALK_ROUTING_MIN_METERS) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WALK_ROUTING_TIMEOUT_MS);
  try {
    const response = await fetch(WALK_ROUTING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        locations: [
          { lat: from[1], lon: from[0], type: 'break' },
          { lat: to[1], lon: to[0], type: 'break' },
        ],
        costing: transport === 'bici' ? 'bicycle' : 'pedestrian',
        /*
         * A piedi il collegamento si percorre spingendo la bicicletta: deve
         * passare dove si cammina davvero. I fattori sotto 1 rendono piu'
         * convenienti percorsi pedonali e marciapiedi, quelli sopra 1
         * scoraggiano vicoli e passi carrai; il resto esclude scale e sentieri
         * impegnativi, che con una bici a mano non sono un'alternativa.
         *
         * In bicicletta si chiede il profilo da citta' con la massima
         * preferenza per le strade tranquille: quel tratto e' fuori dai dati
         * del progetto, quindi non c'e' un punteggio di sicurezza nostro a
         * guidarlo, e conviene lasciare decidere al servizio con il criterio
         * piu' prudente che espone.
         */
        costing_options:
          transport === 'bici'
            ? {
                bicycle: {
                  bicycle_type: 'Hybrid',
                  use_roads: 0.2,
                  use_hills: 0.3,
                  avoid_bad_surfaces: 0.5,
                },
              }
            : {
                pedestrian: {
                  walkway_factor: 0.4,
                  sidewalk_factor: 0.6,
                  alley_factor: 2.5,
                  driveway_factor: 6,
                  step_penalty: 60,
                  max_hiking_difficulty: 1,
                  use_tracks: 0.3,
                  use_lit: 0.6,
                },
              },
        directions_options: { units: 'kilometers' },
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      trip?: { legs?: { shape?: string }[] };
    };

    const coords: LngLat[] = [];
    for (const leg of payload.trip?.legs ?? []) {
      if (!leg.shape) continue;
      const part = decodePolyline6(leg.shape);
      if (coords.length === 0) coords.push(...part);
      else coords.push(...part.slice(1));
    }
    return coords.length >= 2 ? coords : null;
  } catch {
    // Servizio irraggiungibile, offline, o richiesta scaduta: si tiene il
    // tratto calcolato offline invece di far fallire il percorso.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Collegamento a piedi ridisegnato sulla rete pedonale. */
function refinedSegment(segment: RouteSegment, path: LngLat[]): RouteSegment {
  // Gli estremi restano quelli del percorso offline: il punto dell'utente e il
  // nodo del grafo. Il servizio pedonale aggancia alla via piu' vicina e i due
  // punti possono spostarsi di qualche metro; ricucirli evita buchi visibili.
  const coordinates: LngLat[] = [
    segment.coordinates[0],
    ...path,
    segment.coordinates[segment.coordinates.length - 1],
  ];
  const distanceMeters = lineLength(coordinates);
  const speed = segment.transport === 'bici' ? CYCLING_SPEED_KMH : WALKING_SPEED_KMH;
  return {
    ...segment,
    coordinates,
    distanceMeters,
    durationSeconds: (distanceMeters / 1000 / speed) * 3600,
    routed: true,
  };
}

/** Geometria completa a partire dai segmenti, senza ripetere le giunzioni. */
function assemble(segments: RouteSegment[]): LngLat[] {
  const geometry: LngLat[] = [];
  for (const segment of segments) {
    if (geometry.length === 0) geometry.push(...segment.coordinates);
    else geometry.push(...segment.coordinates.slice(1));
  }
  return geometry;
}

/**
 * Ricalcola su strada i collegamenti a piedi di un percorso e ne aggiorna
 * geometria, progressive e totali. Restituisce il percorso invariato se non
 * c'e' nulla da rifinire o se il servizio non risponde.
 */
export async function refineWalkingLegs(route: Route): Promise<Route> {
  const walkLegs = route.segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.kind === 'piedi' && !segment.routed);
  if (walkLegs.length === 0) return route;

  const paths = await Promise.all(
    walkLegs.map(({ segment }) =>
      walkingPath(
        segment.coordinates[0],
        segment.coordinates[segment.coordinates.length - 1],
        segment.transport ?? 'piedi',
      ),
    ),
  );
  if (paths.every((path) => path === null)) return route;

  const segments = [...route.segments];
  // Scarto di lunghezza introdotto prima e dopo la parte in bicicletta: serve a
  // rimettere in fase le progressive delle istruzioni.
  let leadingDelta = 0;
  let trailingDelta = 0;
  const cyclingStart = segments.findIndex((s) => s.kind !== 'piedi');

  walkLegs.forEach(({ index }, position) => {
    const path = paths[position];
    if (!path) return;
    const next = refinedSegment(segments[index], path);
    /*
     * Fra il punto e la rete puo' esserci un'autostrada o una ferrovia: la
     * rete pedonale risponde allora con il giro reale, che puo' essere di
     * chilometri. E' una risposta corretta ma inutilizzabile, e fa sembrare il
     * percorso una camminata interminabile: meglio tenere il collegamento in
     * linea d'aria, che l'interfaccia dichiara come tale.
     */
    if (next.distanceMeters > segments[index].distanceMeters * WALK_ROUTING_MAX_DETOUR) return;
    const delta = next.distanceMeters - segments[index].distanceMeters;
    if (cyclingStart === -1 || index < cyclingStart) leadingDelta += delta;
    else trailingDelta += delta;
    segments[index] = next;
  });

  const walkingMeters = segments
    .filter((s) => s.kind === 'piedi')
    .reduce((sum, s) => sum + s.distanceMeters, 0);
  const distanceMeters = route.distanceMeters + leadingDelta + trailingDelta;
  // Il tempo si ricalcola dai segmenti, non dagli scarti: i due raccordi
  // possono essere percorsi con mezzi diversi, e sommarli alla stessa velocita'
  // darebbe una stima sbagliata.
  const durationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

  // Le due istruzioni a piedi si riferiscono al collegamento prima e a quello
  // dopo la parte in bicicletta; si aggiornano solo se quel tratto e' stato
  // davvero ridisegnato, altrimenti resta il testo che dichiara la linea d'aria.
  const rifinito = (index: number): RouteSegment | null =>
    segments[index]?.routed === true ? segments[index] : null;
  // Un percorso interamente a piedi non ha una parte pedalata in mezzo: il suo
  // unico tratto sta comunque "prima" della pedalata che non c'e'.
  const primaDellaPedalata = (index: number): boolean =>
    cyclingStart === -1 || index < cyclingStart;
  const leadingLeg = rifinito(
    walkLegs.find((leg) => primaDellaPedalata(leg.index))?.index ?? -1,
  );
  const trailingLeg =
    cyclingStart === -1
      ? null
      : rifinito(
          [...walkLegs].reverse().find((leg) => leg.index > cyclingStart)?.index ?? -1,
        );

  const instructions = route.instructions.map((instruction) => {
    if (instruction.type === 'walk-start' && leadingLeg) {
      return {
        ...instruction,
        // Dove non c'e' una parte pedalata il testo resta quello che era: non
        // si raggiunge nessun "inizio del percorso ciclabile", si cammina fino
        // a destinazione.
        text:
          cyclingStart === -1
            ? instruction.text
            : 'Raggiungi a piedi, seguendo le strade, l’inizio del percorso ciclabile',
        distanceMeters: leadingLeg.distanceMeters,
        durationSeconds: leadingLeg.durationSeconds,
      };
    }
    if (instruction.type === 'walk-end' && trailingLeg) {
      return {
        ...instruction,
        distanceMeters: trailingLeg.distanceMeters,
        durationSeconds: trailingLeg.durationSeconds,
        offsetMeters: instruction.offsetMeters + leadingDelta,
      };
    }
    if (instruction.type === 'arrive') {
      return {
        ...instruction,
        offsetMeters: instruction.offsetMeters + leadingDelta + trailingDelta,
      };
    }
    return { ...instruction, offsetMeters: instruction.offsetMeters + leadingDelta };
  });

  return {
    ...route,
    geometry: assemble(segments),
    segments,
    instructions,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    walkingMeters: Math.round(walkingMeters),
    bicipolitanaPercentage:
      distanceMeters > 0 ? Math.round((route.bicipolitanaMeters / distanceMeters) * 100) : 0,
    walkingRouted: segments.some((s) => s.kind === 'piedi' && s.routed === true),
  };
}

/** Rifinisce piu' percorsi in parallelo; quelli non rifinibili restano com'erano. */
export function refineRoutes(routes: Route[]): Promise<Route[]> {
  return Promise.all(routes.map((route) => refineWalkingLegs(route).catch(() => route)));
}
