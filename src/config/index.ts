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

/**
 * Colore dei tratti a piedi.
 *
 * Non e' il grigio della viabilita' ordinaria: quello lo usano i tratti
 * *pedalati* fuori dalla Bicipolitana, e con lo stesso colore un percorso che
 * corre a lungo su strade normali si legge come una camminata interminabile.
 * Il viola non appartiene a nessuna linea della rete, quindi non puo' essere
 * scambiato per una di esse.
 */
export const WALK_COLOR = '#6d28d9';

/**
 * Quanto pesa un minuto a piedi rispetto a un minuto in bicicletta.
 *
 * Il tempo da solo non basta a scoraggiare il cammino: spingere la bici e'
 * peggio che pedalare anche a parita' di minuti. Senza questa maggiorazione il
 * calcolo accetterebbe volentieri qualche centinaio di metri a piedi pur di
 * risparmiare una curva.
 */
export const WALK_COST_FACTOR = num(env.VITE_WALK_COST_FACTOR, 2.2);

/**
 * Quanto conta la pericolosita' della strada su cui ci si innesta, nel
 * decidere dove entrare in rete a piedi.
 *
 * Camminare sul ciglio di una strada a scorrimento — e poi immettersi in
 * bicicletta proprio li' — non e' come arrivare a una ciclabile o a una via
 * residenziale. Il punteggio di sicurezza dell'arco (euristico, dichiarato)
 * moltiplica il costo del cammino: a zero il percorso sceglie sempre
 * l'innesto piu' vicino, com'era prima.
 */
export const WALK_SAFETY_WEIGHT = num(env.VITE_WALK_SAFETY_WEIGHT, 2.5);

/** Raggio entro cui il punto si considera *sulla* rete coperta dai dati. */
export const SNAP_MAX_DISTANCE_METERS = num(env.VITE_SNAP_MAX_DISTANCE_METERS, 700);

/**
 * Oltre il raggio di aggancio diretto il punto non viene rifiutato: si cerca la
 * rete fino a questa distanza e il tratto scoperto diventa un collegamento
 * esplicito.
 *
 * Il valore copre l'intera provincia: da qualunque punto attorno a Pesaro il
 * percorso viene calcolato, e il collegamento fino alla rete viene mostrato per
 * quello che e'. Il limite resta solo per non pretendere di collegare alla
 * Bicipolitana un punto che con Pesaro non ha niente a che vedere.
 */
export const WALK_SNAP_MAX_DISTANCE_METERS = num(
  env.VITE_WALK_SNAP_MAX_DISTANCE_METERS,
  40000,
);

/**
 * Oltre questa lunghezza il collegamento non si fa a piedi.
 *
 * Chi chiede un percorso ciclabile ha una bicicletta: proporgli un'ora di
 * cammino perche' i dati del progetto finiscono prima di casa sua non e' una
 * risposta. Sotto la soglia il raccordo resta un tratto a piedi — si spinge la
 * bici per attraversare o per uscire da un cortile; sopra, si pedala, sulle
 * strade che il servizio esterno conosce e il progetto no.
 */
export const CONNECTOR_RIDE_THRESHOLD_METERS = num(
  env.VITE_CONNECTOR_RIDE_THRESHOLD_METERS,
  500,
);

/**
 * Servizio di calcolo del percorso a piedi usato SOLO per i tratti di
 * collegamento fra il punto scelto e la rete coperta dai dati del progetto.
 *
 * Il grafo offline copre la Bicipolitana e la viabilita' del comune di Pesaro:
 * fuori da li' il collegamento resterebbe una linea d'aria attraverso i campi.
 * Con questo servizio quel tratto segue le strade reali. E' facoltativo:
 * lasciare il valore vuoto disattiva la chiamata e riporta il comportamento
 * completamente offline, con il collegamento in linea d'aria.
 */
export const WALK_ROUTING_URL =
  env.VITE_WALK_ROUTING_URL ?? 'https://valhalla1.openstreetmap.de/route';

/** Tempo massimo di attesa del servizio pedonale: scaduto, si tiene il tratto offline. */
export const WALK_ROUTING_TIMEOUT_MS = num(env.VITE_WALK_ROUTING_TIMEOUT_MS, 6000);

// ---------------------------------------------------------------------------
// Meteo
// ---------------------------------------------------------------------------

/**
 * Servizio meteo. Il valore predefinito e' Open-Meteo: gratuito, senza chiave
 * e senza registrazione, quindi non introduce segreti da custodire ne' un
 * backend da mantenere. I dati sono CC BY 4.0 e l'attribuzione va mostrata.
 *
 * Lasciare il valore vuoto disattiva del tutto l'indicatore del meteo.
 */
export const WEATHER_URL =
  env.VITE_WEATHER_URL ?? 'https://api.open-meteo.com/v1/forecast';

/** Ogni quanto si richiede il meteo aggiornato. */
export const WEATHER_REFRESH_MS = num(env.VITE_WEATHER_REFRESH_MS, 10 * 60 * 1000);

/** Quante ore di previsione mostrare: oltre mezza giornata non serve a una gita. */
export const WEATHER_FORECAST_HOURS = num(env.VITE_WEATHER_FORECAST_HOURS, 12);

/** Oltre questa attesa la richiesta viene abbandonata. */
export const WEATHER_TIMEOUT_MS = num(env.VITE_WEATHER_TIMEOUT_MS, 8000);

/** Sotto questa distanza il collegamento e' troppo corto perche' valga una chiamata. */
export const WALK_ROUTING_MIN_METERS = num(env.VITE_WALK_ROUTING_MIN_METERS, 40);

/**
 * Quanto puo' allungarsi il collegamento una volta ricalcolato sulle strade,
 * rispetto alla linea d'aria, prima di essere considerato non plausibile.
 *
 * Fra il punto e la rete puo' esserci un'autostrada o una ferrovia: la rete
 * pedonale risponde allora con il giro reale, che puo' essere di chilometri.
 * E' una risposta corretta ma inutile — nessuno la farebbe — e soprattutto
 * ingannevole, perche' fa sembrare il percorso una camminata lunghissima. In
 * quel caso si tiene il collegamento in linea d'aria, dichiarato come tale.
 */
export const WALK_ROUTING_MAX_DETOUR = num(env.VITE_WALK_ROUTING_MAX_DETOUR, 2.5);

/** Soglia di fuori-percorso oltre la quale scatta il ricalcolo. */
export const REROUTE_DISTANCE_THRESHOLD = num(env.VITE_REROUTE_DISTANCE_THRESHOLD, 45);

/** Attesa prima di ricalcolare, per non reagire a un singolo punto GPS sporco. */
export const REROUTE_DEBOUNCE_MS = num(env.VITE_REROUTE_DEBOUNCE_MS, 4000);

/**
 * Attesa minima fra due ricalcoli consecutivi. Serve a non rilanciare il
 * calcolo a ogni punto GPS quando si resta fuori percorso a lungo.
 */
export const REROUTE_COOLDOWN_MS = num(env.VITE_REROUTE_COOLDOWN_MS, 8000);

/** Distanza sotto la quale si considera raggiunta la destinazione. */
export const ARRIVAL_THRESHOLD_METERS = num(env.VITE_ARRIVAL_THRESHOLD_METERS, 25);

/**
 * Guida vocale: distanze a cui una manovra viene annunciata.
 *
 * Sono tarate sulla bicicletta. A 15 km/h trecento metri sono poco piu' di un
 * minuto — l'anticipo giusto per accostare o cambiare corsia — e sessanta
 * metri sono i pochi secondi in cui la manovra va fatta davvero.
 */
export const VOICE_PREPARE_METERS = num(env.VITE_VOICE_PREPARE_METERS, 300);
export const VOICE_NOW_METERS = num(env.VITE_VOICE_NOW_METERS, 60);

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
 * Quanto la penalita' di pericolosita' cresce piu' che proporzionalmente.
 *
 * Con una penalita' lineare una strada a scorrimento costa poco piu' di una
 * via residenziale: sul profilo predefinito bastava che una statale fosse il
 * 19% piu' corta perche' il calcolo la preferisse, e i percorsi finivano sulla
 * Adriatica o sulla Provinciale 423. Ma per chi pedala il salto fra una via di
 * quartiere e una strada di grande traffico non e' graduale: e' un cambio di
 * categoria, e va pagato come tale.
 *
 * Il termine diventa quindi `w * d * (1 + boost * d)`, con `d = 1 - s` la
 * pericolosita' dell'arco: sulle strade tranquille cambia pochissimo, su
 * quelle esposte cresce in fretta. A 0 si torna esattamente al comportamento
 * lineare di prima.
 */
export const DANGER_BOOST = num(env.VITE_DANGER_BOOST, 2);

/**
 * Classi OSM considerate strade a traffico intenso: statali, provinciali e
 * grandi arterie urbane. Sono le stesse che ricevono i punteggi di sicurezza
 * piu' bassi nella pipeline.
 */
export const BUSY_HIGHWAY_CLASSES = new Set([
  'trunk',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
]);

/**
 * Oltre questa lunghezza complessiva su strade a traffico intenso il percorso
 * lo dichiara.
 *
 * Un incrocio da attraversare non e' una notizia; qualche centinaio di metri
 * di affiancamento alle auto lo e'. A volte quel tratto e' inevitabile —
 * nei dati certe strade sono l'unico collegamento — e in quel caso l'unica
 * risposta onesta e' dirlo, invece di far scoprire la statale pedalando.
 */
export const BUSY_ROAD_WARNING_METERS = num(env.VITE_BUSY_ROAD_WARNING_METERS, 150);

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

/**
 * Quanti percorsi mostrare al massimo per una stessa richiesta.
 *
 * I quattro profili non bastano a coprire le alternative reali: su una citta'
 * lunga e stretta come Pesaro finiscono spesso nello stesso corridoio, e
 * quello che resta e' un percorso solo. Oltre ai profili il router cerca
 * quindi altre strade evitando i tratti gia' proposti, fino a questo numero.
 */
export const MAX_ROUTE_ALTERNATIVES = num(env.VITE_MAX_ROUTE_ALTERNATIVES, 5);

/**
 * Quanto due percorsi possono somigliarsi, come frazione di lunghezza fatta
 * sugli stessi archi. Le due soglie rispondono a due domande diverse.
 *
 * Per i profili si scartano solo i doppioni veri: "piu' veloce" e
 * "Bicipolitana" possono coincidere quasi del tutto e restano comunque due
 * risposte oneste a due domande diverse, e togliere a un profilo la sua
 * risposta migliore perche' somiglia a quella di un altro sarebbe peggio.
 *
 * Per le alternative ricavate evitando i tratti gia' proposti la soglia e'
 * severa: nascono per aggiungere una strada diversa, e se non lo fanno non
 * hanno motivo di comparire.
 */
export const ROUTE_DUPLICATE_THRESHOLD = num(env.VITE_ROUTE_DUPLICATE_THRESHOLD, 0.9);
export const ROUTE_SIMILARITY_THRESHOLD = num(env.VITE_ROUTE_SIMILARITY_THRESHOLD, 0.7);

/**
 * Di quanto si penalizzano gli archi gia' proposti, a ogni giro di ricerca.
 *
 * Un solo giro non basta: con una penalita' leggera il calcolo ritrova quasi
 * lo stesso percorso, con una pesante lo manda subito troppo lontano. Si sale
 * per gradi e ci si ferma appena le alternative sono abbastanza diverse.
 */
export const ROUTE_ALTERNATIVE_PENALTIES = [1.8, 3.2, 6];

/**
 * Quanto puo' allungarsi una variante rispetto al miglior percorso trovato.
 *
 * Le varianti nascono rendendo piu' cari i tratti gia' proposti: esaurite le
 * strade buone, la ricerca ripiega su quel che resta, e quel che resta e'
 * spesso la statale. Una proposta lunga il 45% in piu' che passa sulla
 * Fogliense non e' un'alternativa allo stesso viaggio, e' un viaggio peggiore:
 * meglio restituire tre percorsi buoni che sei di cui l'ultimo manda in
 * mezzo alle auto.
 */
export const ROUTE_VARIANT_MAX_DETOUR = num(env.VITE_ROUTE_VARIANT_MAX_DETOUR, 1.4);

/**
 * Quanti metri di strade a traffico intenso una variante puo' aggiungere
 * rispetto al miglior percorso.
 *
 * Il margine copre i casi in cui un attraversamento in piu' e' inevitabile;
 * oltre, la variante sta comprando la propria diversita' con l'esposizione al
 * traffico, che e' esattamente cio' che l'applicazione dovrebbe evitare.
 */
export const ROUTE_VARIANT_MAX_BUSY_EXCESS_METERS = num(
  env.VITE_ROUTE_VARIANT_MAX_BUSY_EXCESS,
  300,
);

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
