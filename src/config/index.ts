/**
 * Configurazione dell'applicazione.
 *
 * Ogni valore di modello (velocita', penalita', soglie) e' una STIMA
 * dichiarata: non deriva da misure di campo. I valori possono essere
 * sovrascritti tramite variabili d'ambiente Vite (file `.env`).
 */
import type { RoutingProfile, RoutingProfileId } from '../types';

const env = import.meta.env;

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
};

/** Percorso base: funziona sia in locale sia in sottocartella GitHub Pages. */
export const BASE_URL = env.BASE_URL ?? '/';

export const dataUrl = (file: string): string =>
  `${BASE_URL.replace(/\/$/, '')}/data/${file}`;

// ---------------------------------------------------------------------------
// Mappa
// ---------------------------------------------------------------------------

/** Centro di Pesaro, derivato dal bounding box dei dati Bicipolitana. */
export const PESARO_CENTER: [number, number] = [12.9089, 43.9061];

/** Estensione dei dati del progetto (WGS84): usata per fit e per limitare la ricerca. */
export const PESARO_BOUNDS: [[number, number], [number, number]] = [
  [12.83, 43.835],
  [12.997, 43.94],
];

export const MAP_DEFAULT_ZOOM = 13;
export const MAP_MIN_ZOOM = 10;
export const MAP_MAX_ZOOM = 19;

/**
 * Provider cartografico configurabile.
 *
 * Il default e' lo stile **Positron di OpenFreeMap**: gratuito, senza chiave
 * API e senza limiti d'uso dichiarati, visivamente equivalente al basemap
 * CARTO Positron usato nel progetto QGIS originale. CARTO non e' piu' adatto
 * come default perche' le sue mattonelle senza chiave vengono servite con una
 * filigrana "API KEY REQUIRED".
 *
 * Se lo stile non e' raggiungibile si ripiega automaticamente sulle
 * mattonelle raster indicate in `BASEMAP_RASTER`.
 *
 * L'attribuzione richiesta dal provider e' sempre mostrata e non e'
 * rimovibile dall'interfaccia.
 */
export const BASEMAP_STYLE_URL =
  env.VITE_BASEMAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron';

export const BASEMAP_RASTER = {
  url: env.VITE_BASEMAP_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileSize: num(env.VITE_BASEMAP_TILE_SIZE, 256),
  maxZoom: num(env.VITE_BASEMAP_MAX_ZOOM, 19),
};

export const BASEMAP_ATTRIBUTION =
  env.VITE_BASEMAP_ATTRIBUTION ??
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
    'sfondo <a href="https://openfreemap.org">OpenFreeMap</a>';

/**
 * Font usato dalle etichette aggiunte dall'applicazione. Deve esistere fra i
 * glifi dello stile scelto: OpenFreeMap espone la famiglia Noto Sans.
 */
export const MAP_LABEL_FONT = (env.VITE_MAP_LABEL_FONT ?? 'Noto Sans Bold').split(',');

/**
 * Endpoint dei glifi usato solo quando si ripiega sullo stile raster, che non
 * ne porta uno proprio. Se non raggiungibile, le etichette non vengono
 * disegnate ma la mappa resta pienamente utilizzabile.
 */
export const GLYPHS_URL =
  env.VITE_GLYPHS_URL ?? 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Velocita' media di crociera usata per stimare i tempi. Stima. */
export const CYCLING_SPEED_KMH = num(env.VITE_CYCLING_SPEED_KMH, 15);

/**
 * Velocita' media a piedi, usata per stimare i tratti di collegamento fra il
 * punto scelto e la rete coperta dai dati. Stima.
 */
export const WALKING_SPEED_KMH = num(env.VITE_WALKING_SPEED_KMH, 4.8);

/**
 * Sotto questa distanza il collegamento non viene mostrato: sarebbe rumore
 * grafico, non un tratto da percorrere.
 */
export const WALK_LEG_MIN_METERS = num(env.VITE_WALK_LEG_MIN_METERS, 20);

/** Colore dei tratti a piedi: neutro, per non confonderli con una linea. */
export const WALK_COLOR = '#64748b';

/** Raggio entro cui il punto si considera *sulla* rete coperta dai dati. */
export const SNAP_MAX_DISTANCE_METERS = num(env.VITE_SNAP_MAX_DISTANCE_METERS, 700);

/**
 * Oltre il raggio di aggancio diretto il punto non viene rifiutato: si cerca la
 * rete fino a questa distanza e il tratto scoperto diventa un collegamento a
 * piedi esplicito. Il limite esiste solo per non inventare percorsi da punti
 * che con Pesaro non hanno niente a che vedere.
 */
export const WALK_SNAP_MAX_DISTANCE_METERS = num(
  env.VITE_WALK_SNAP_MAX_DISTANCE_METERS,
  8000,
);

/** Soglia di fuori-percorso oltre la quale scatta il ricalcolo. */
export const REROUTE_DISTANCE_THRESHOLD = num(env.VITE_REROUTE_DISTANCE_THRESHOLD, 45);

/** Attesa prima di ricalcolare, per non reagire a un singolo punto GPS sporco. */
export const REROUTE_DEBOUNCE_MS = num(env.VITE_REROUTE_DEBOUNCE_MS, 6000);

/** Distanza sotto la quale si considera raggiunta la destinazione. */
export const ARRIVAL_THRESHOLD_METERS = num(env.VITE_ARRIVAL_THRESHOLD_METERS, 25);

/** Precisione GPS oltre la quale la posizione e' considerata inaffidabile. */
export const GPS_MAX_ACCEPTABLE_ACCURACY_METERS = num(
  env.VITE_GPS_MAX_ACCURACY_METERS,
  60,
);

/** Tratti piu' corti di questa soglia non generano un cambio di linea nel riepilogo. */
export const MIN_SEGMENT_LENGTH_METERS = num(env.VITE_MIN_SEGMENT_LENGTH_METERS, 120);

/** Angolo minimo (gradi) perche' una variazione di direzione diventi una svolta. */
export const TURN_ANGLE_THRESHOLD_DEGREES = num(env.VITE_TURN_ANGLE_THRESHOLD, 35);
export const SHARP_TURN_ANGLE_DEGREES = num(env.VITE_SHARP_TURN_ANGLE, 110);

/**
 * Profili di calcolo.
 *
 * Il costo di un arco parte dal tempo stimato e viene modulato da:
 *   - il tipo di arco (Bicipolitana / viabilita' ordinaria);
 *   - il punteggio di sicurezza euristico dell'arco;
 *   - le penalita' per ostacoli e cambi di linea.
 */
export const ROUTING_PROFILES: Record<RoutingProfileId, RoutingProfile> = {
  bicipolitana: {
    id: 'bicipolitana',
    label: 'Bicipolitana',
    icon: '🚲',
    description: 'Segue il più possibile le linee ufficiali della Bicipolitana',
    bicipolitanaFactor: 0.45,
    roadFactor: 1.35,
    safetyWeight: 0.6,
    obstaclePenaltySeconds: 20,
    lineChangePenaltySeconds: 30,
  },
  fast: {
    id: 'fast',
    label: 'Più veloce',
    icon: '⚡',
    description: 'Minimizza il tempo stimato di percorrenza',
    bicipolitanaFactor: 0.95,
    roadFactor: 1.0,
    safetyWeight: 0.15,
    obstaclePenaltySeconds: 15,
    lineChangePenaltySeconds: 0,
  },
  quiet: {
    id: 'quiet',
    label: 'Più tranquillo',
    icon: '🌿',
    description: 'Predilige ciclabili, parchi e strade a basso traffico',
    bicipolitanaFactor: 0.6,
    roadFactor: 1.15,
    safetyWeight: 1.6,
    obstaclePenaltySeconds: 45,
    lineChangePenaltySeconds: 15,
  },
  safe: {
    id: 'safe',
    label: 'Più sicuro',
    icon: '🛡️',
    description:
      'Più sicuro secondo i dati disponibili: ciclabili, Bicipolitana e strade tranquille',
    bicipolitanaFactor: 0.5,
    roadFactor: 1.25,
    safetyWeight: 2.4,
    obstaclePenaltySeconds: 70,
    lineChangePenaltySeconds: 20,
  },
};

/** Profili proposti nella schermata dei risultati, nell'ordine mostrato. */
export const DEFAULT_PROFILE_ORDER: RoutingProfileId[] = [
  'bicipolitana',
  'fast',
  'quiet',
  'safe',
];

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export const GEOCODING = {
  /** Provider esterno; vuoto = solo ricerca nei dati locali del progetto. */
  url: env.VITE_GEOCODING_API_URL ?? 'https://nominatim.openstreetmap.org/search',
  reverseUrl:
    env.VITE_GEOCODING_REVERSE_URL ?? 'https://nominatim.openstreetmap.org/reverse',
  apiKey: env.VITE_GEOCODING_API_KEY ?? '',
  debounceMs: num(env.VITE_GEOCODING_DEBOUNCE_MS, 350),
  timeoutMs: num(env.VITE_GEOCODING_TIMEOUT_MS, 8000),
  minQueryLength: 3,
  maxResults: 8,
  cacheSize: 60,
  attribution: '© OpenStreetMap contributors',
};

// ---------------------------------------------------------------------------
// Segnalazioni
// ---------------------------------------------------------------------------

export const REPORT_ISSUE_URL = env.VITE_REPORT_ISSUE_URL ?? '';

// ---------------------------------------------------------------------------
// Testi ricorrenti
// ---------------------------------------------------------------------------

export const NOT_AVAILABLE = 'Informazione non disponibile';
export const ESTIMATE_LABEL = 'stima';
