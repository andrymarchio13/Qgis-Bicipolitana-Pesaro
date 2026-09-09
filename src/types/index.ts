/**
 * Tipi condivisi dell'applicazione Bicipolitana Pesaro.
 *
 * Regola trasversale: un campo che il dataset GIS non contiene e' tipizzato
 * come `null`, mai come stringa inventata. L'interfaccia mostra in quel caso
 * "Informazione non disponibile".
 */

/** Coordinata geografica [longitudine, latitudine] in EPSG:4326. */
export type LngLat = [number, number];

export interface Location {
  lng: number;
  lat: number;
  /** Etichetta leggibile; null se non ancora risolta. */
  label: string | null;
  source: 'gps' | 'map' | 'geocoder' | 'poi' | 'line';
  /** Precisione GPS in metri, se nota. */
  accuracy?: number;
}

// ---------------------------------------------------------------------------
// Linee
// ---------------------------------------------------------------------------

export type LineStatus = 'active' | 'unknown';

export interface Line {
  id: string;
  name: string;
  /** Nome ufficiale: assente nel dataset GIS finche' non verificato. */
  officialName: string | null;
  officialNameSource: string;
  color: string;
  colorSource: string;
  colorNeedsConfirmation: boolean;
  colorConflictsWith: string[];
  status: LineStatus;
  statusNote: string;
  lengthMeters: number;
  lengthKm: number;
  segments: number;
  contiguous: boolean;
  endpoints: { start: LngLat; end: LngLat }[];
  estimatedMinutes: number;
  estimatedMinutesNote: string;
}

export interface LinesFile {
  generatedAt: string;
  note: string;
  lines: Line[];
}

// ---------------------------------------------------------------------------
// Punti di interesse
// ---------------------------------------------------------------------------

export type ServiceCategory =
  | 'fontanella'
  | 'parcheggio_bici'
  | 'noleggio'
  | 'officina'
  | 'negozio_bici'
  | 'altro_servizio';

export type ObstacleCategory =
  | 'barriera_ciclabile'
  | 'barriera_doppia'
  | 'barriera_tripla'
  | 'chicane'
  | 'altra_barriera'
  | 'ostacolo_generico';

export type LeisureCategory =
  | 'parco'
  | 'belvedere'
  | 'area_picnic'
  | 'panchina'
  | 'binocolo'
  | 'altro_svago';

export type PoiCategory = ServiceCategory | ObstacleCategory | LeisureCategory;

export type PoiKind = 'servizio' | 'ostacolo' | 'svago';

export interface Poi {
  id: string;
  kind: PoiKind;
  category: PoiCategory;
  categoryLabel: string;
  name: string | null;
  osmId: string | null;
  lng: number;
  lat: number;
  /** Tutti i tag originali del GeoPackage, senza filtri. */
  tags: Record<string, string>;
  /** Solo ostacoli: valore del tag OSM `bicycle`. */
  bicycleAccess?: string | null;
  bicycleAccessLabel?: string;
  maxWidthMeters?: string | null;
  /** Distanza dall'utente in metri, calcolata a runtime. */
  distanceMeters?: number;
}

// ---------------------------------------------------------------------------
// Grafo di routing
// ---------------------------------------------------------------------------

/** 0 = Bicipolitana, 1 = strada, 2 = connettore topologico. */
export type EdgeKind = 0 | 1 | 2;

export interface GraphEdge {
  i: number;
  a: number;
  b: number;
  /** Lunghezza in metri. */
  d: number;
  /** Tempo stimato in secondi. */
  t: number;
  k: EdgeKind;
  /** Punteggio di sicurezza euristico 0..1. */
  s: number;
  /** Geometria [lng, lat][]. */
  g: LngLat[];
  /** Id linea Bicipolitana. */
  l?: string;
  /** Colore della linea. */
  c?: string;
  /** Tag `highway` OSM. */
  hw?: string;
  /** Nome della via. */
  n?: string;
  /** Tag `surface` OSM. */
  sf?: string;
  /** Fattore di velocita' della superficie. */
  sfc?: number;
  /** Senso unico per la bici: 1 = a→b, -1 = b→a. */
  ow?: 1 | -1;
  /** Id degli ostacoli entro il raggio di influenza. */
  o?: string[];
  /** Ostacolo con obbligo di scendere dalla bici. */
  dm?: 1;
  /** Ostacolo con transito vietato. */
  bk?: 1;
  /**
   * Arco a piedi creato per una singola richiesta, non presente nei dati:
   * collega il punto scelto dall'utente al punto in cui entra in rete.
   */
  vw?: 1;
}

export interface RoutingGraph {
  generatedAt: string;
  crs: string;
  schema: unknown;
  parameters: {
    snapToleranceMeters: number;
    obstacleInfluenceRadiusMeters: number;
    simplifyToleranceMeters: number;
    cyclingSpeedKmh: number;
    minEdgeLengthMeters: number;
    note: string;
    [k: string]: unknown;
  };
  nodes: LngLat[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Percorsi
// ---------------------------------------------------------------------------

export type RoutingProfileId = 'bicipolitana' | 'fast' | 'quiet' | 'safe';

export interface RoutingProfile {
  id: RoutingProfileId;
  label: string;
  icon: string;
  description: string;
  /** Moltiplicatore del costo per gli archi della Bicipolitana (<1 = preferita). */
  bicipolitanaFactor: number;
  /** Moltiplicatore per gli archi stradali generici. */
  roadFactor: number;
  /** Peso del punteggio di sicurezza: costo *= 1 + w * (1 - safety). */
  safetyWeight: number;
  /** Penalita' in secondi per ogni ostacolo attraversato. */
  obstaclePenaltySeconds: number;
  /** Penalita' in secondi per ogni cambio di linea. */
  lineChangePenaltySeconds: number;
}

export interface RouteStep {
  edge: GraphEdge;
  /** Geometria gia' orientata nel verso di marcia. */
  coordinates: LngLat[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteSegment {
  /** Id linea Bicipolitana, oppure null per tratti su viabilita' ordinaria. */
  lineId: string | null;
  lineName: string | null;
  color: string;
  /**
   * `piedi` indica il collegamento fra il punto scelto dall'utente e la rete
   * coperta dai dati: non e' un percorso calcolato ma un tratto in linea
   * d'aria, da fare a piedi.
   */
  kind: 'bicipolitana' | 'strada' | 'piedi';
  distanceMeters: number;
  durationSeconds: number;
  coordinates: LngLat[];
  /** Nomi delle vie percorse, quando disponibili nel dataset OSM. */
  streetNames: string[];
  /**
   * Solo per i tratti `piedi`: true quando il collegamento e' stato ricalcolato
   * sulla rete reale invece di restare in linea d'aria.
   */
  routed?: boolean;
  /**
   * Come si percorre il collegamento fuori rete. Un raccordo di pochi metri si
   * fa spingendo la bici; uno di chilometri si pedala, perche' chi chiede un
   * percorso ciclabile la bicicletta ce l'ha.
   */
  transport?: 'piedi' | 'bici';
}

export type ManeuverType =
  | 'walk-start'
  | 'walk-end'
  | 'start'
  | 'continue'
  | 'left'
  | 'slight-left'
  | 'right'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'enter-line'
  | 'change-line'
  | 'leave-line'
  | 'arrive';

export interface RouteInstruction {
  index: number;
  type: ManeuverType;
  text: string;
  /** Distanza da percorrere prima della manovra successiva. */
  distanceMeters: number;
  durationSeconds: number;
  location: LngLat;
  lineId: string | null;
  color: string | null;
  /** Nome della via, se presente nei dati OSM. */
  streetName: string | null;
  /** Progressiva lungo il percorso, in metri. */
  offsetMeters: number;
  /**
   * Solo per i raccordi fuori rete: come si percorrono. L'interfaccia deve
   * poter mostrare la bicicletta invece del pedone quando il collegamento e'
   * lungo chilometri.
   */
  transport?: 'piedi' | 'bici';
}

export interface RouteWarning {
  type: 'obstacle' | 'dismount' | 'blocked' | 'data' | 'traffico';
  message: string;
  location?: LngLat;
}

export interface Route {
  id: string;
  profile: RoutingProfileId;
  profileLabel: string;
  profileIcon: string;
  distanceMeters: number;
  durationSeconds: number;
  durationMinutes: number;
  /** Geometria completa del percorso. */
  geometry: LngLat[];
  segments: RouteSegment[];
  instructions: RouteInstruction[];
  /** Id delle linee Bicipolitana effettivamente utilizzate, in ordine. */
  linesUsed: string[];
  bicipolitanaPercentage: number;
  bicipolitanaMeters: number;
  /** Metri da percorrere a piedi, fuori dalla rete coperta dai dati. */
  walkingMeters: number;
  warnings: RouteWarning[];
  obstacleIds: string[];
  /** I tempi sono stime, non misure. */
  durationIsEstimate: true;
  /** true quando i tratti a piedi seguono le strade e non la linea d'aria. */
  walkingRouted?: boolean;
  /**
   * true per i percorsi nati evitando i tratti gia' proposti, invece che da un
   * profilo diverso. Cambia come vanno presentati: non sono "piu' veloce" o
   * "piu' tranquillo", sono un'altra strada per lo stesso viaggio.
   */
  isVariant?: boolean;
}

// ---------------------------------------------------------------------------
// Navigazione
// ---------------------------------------------------------------------------

export interface NavigationState {
  active: boolean;
  route: Route | null;
  /** Indice dell'istruzione corrente. */
  stepIndex: number;
  /** Progressiva percorsa in metri. */
  traveledMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  /** Distanza fra utente e percorso, in metri. */
  offRouteMeters: number;
  offRoute: boolean;
  rerouting: boolean;
  arrived: boolean;
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export interface GeocodingResult {
  id: string;
  label: string;
  sublabel: string | null;
  lng: number;
  lat: number;
  /** Provenienza del risultato: dati locali del progetto o servizio esterno. */
  source: 'locale' | 'esterno';
  kind: 'poi' | 'linea' | 'indirizzo' | 'luogo';
  distanceMeters?: number;
}

export interface GeocodingProvider {
  readonly name: string;
  readonly attribution: string | null;
  search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]>;
  reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<GeocodingResult | null>;
}

// ---------------------------------------------------------------------------
// Metadati
// ---------------------------------------------------------------------------

export interface ProjectMetadata {
  project: string;
  source: string;
  sourceFiles: string[];
  crsOriginal: string;
  webCrs: string;
  metricCrs: string;
  generatedAt: string;
  sources: string[];
  attribution: string;
  counts: Record<string, number>;
  categories: Record<string, Record<string, number>>;
  excludedFeatures: { feature: number; line?: string; reason: string }[];
  estimates: { cyclingSpeedKmh: number; note: string };
  [k: string]: unknown;
}

/** Segnalazione di interruzione/lavori: mostrata SOLO se esiste una fonte. */
export interface Incident {
  id: string;
  lineId: string | null;
  type: 'closure' | 'works' | 'obstacle' | 'other';
  description: string;
  start: string | null;
  end: string | null;
  /** Obbligatoria: senza fonte verificabile l'incidente non viene mostrato. */
  source: string;
  url?: string;
}
