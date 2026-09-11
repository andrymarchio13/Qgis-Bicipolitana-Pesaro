/** Stato globale dell'applicazione. */
import { create } from 'zustand';

import { DEFAULT_PROFILE_ORDER } from '../config';
import { loadProjectData, loadRoutingGraph, type ProjectData } from '../services/data';
import {
  CompositeGeocodingProvider,
  LocalGeocodingProvider,
  NominatimProvider,
  streetIndexFromGraph,
} from '../services/geocoding';
import type { ItineraryFile } from '../services/itinerary';
import {
  loadReports,
  mergeReports,
  saveReports,
  type UserReport,
} from '../services/reports';
import { RoutingGraphIndex } from '../services/routing/graph';
import { BicipolitanaRouter, orderRoutes, RoutingError } from '../services/routing/router';
import { refineRoutes } from '../services/routing/walk';
import type {
  GeocodingProvider,
  LngLat,
  Location,
  PoiCategory,
  Route,
  RoutingProfileId,
} from '../types';

export type LoadPhase = 'idle' | 'loading-data' | 'loading-graph' | 'ready' | 'error';

export interface LayerVisibility {
  linee: boolean;
  ciclabili: boolean;
  servizi: boolean;
  fontanelle: boolean;
  parcheggi: boolean;
  officine: boolean;
  noleggio: boolean;
  parchi: boolean;
  belvedere: boolean;
  ostacoli: boolean;
  /** Le segnalazioni scritte da chi usa l'app. */
  segnalazioni: boolean;
}

export const DEFAULT_LAYERS: LayerVisibility = {
  linee: true,
  ciclabili: false,
  servizi: true,
  fontanelle: true,
  parcheggi: true,
  officine: true,
  noleggio: true,
  parchi: true,
  belvedere: true,
  ostacoli: true,
  segnalazioni: true,
};

/** Categorie POI associate a ciascun interruttore del pannello filtri. */
export const LAYER_CATEGORIES: Partial<Record<keyof LayerVisibility, PoiCategory[]>> = {
  fontanelle: ['fontanella'],
  parcheggi: ['parcheggio_bici'],
  officine: ['officina', 'negozio_bici'],
  noleggio: ['noleggio'],
  parchi: ['parco', 'area_picnic'],
  belvedere: ['belvedere', 'binocolo', 'panchina'],
  ostacoli: [
    'barriera_ciclabile',
    'barriera_doppia',
    'barriera_tripla',
    'chicane',
    'altra_barriera',
    'ostacolo_generico',
  ],
};

interface AppState {
  phase: LoadPhase;
  error: string | null;
  data: ProjectData | null;
  graphIndex: RoutingGraphIndex | null;
  router: BicipolitanaRouter | null;
  geocoder: GeocodingProvider | null;

  origin: Location | null;
  destination: Location | null;
  preferredLineId: string | null;

  routes: Route[];
  selectedRouteId: string | null;
  routingError: string | null;
  calculating: boolean;

  layers: LayerVisibility;
  /**
   * Mostra sulla mappa soltanto i punti che stanno lungo il percorso scelto.
   * Con quindici linee e settantotto punti la mappa e' piena: quando un
   * percorso c'e', quasi sempre interessano solo le fontanelle e le officine
   * che si incontrano davvero.
   */
  onlyAlongRoute: boolean;
  /**
   * Segnalazioni scritte da chi usa l'app, lette dal deposito locale
   * all'avvio. Non sono dati del progetto e non entrano nel calcolo del
   * percorso: vivono accanto ai dati, mai dentro.
   */
  reports: UserReport[];
  /** false quando il browser non ha permesso di salvarle (navigazione privata). */
  reportsPersisted: boolean;
  /** Punto su cui portare la mappa, scelto dall'elenco delle segnalazioni. */
  focusPoint: LngLat | null;
  highlightedLineId: string | null;

  /** Punto che l'utente sta scegliendo cliccando sulla mappa. */
  pickingMode: 'origin' | 'destination' | 'report' | null;

  init: () => Promise<void>;
  setOrigin: (location: Location | null) => void;
  setDestination: (location: Location | null) => void;
  swapEndpoints: () => void;
  setPreferredLine: (lineId: string | null) => void;
  calculateRoutes: (profiles?: RoutingProfileId[]) => void;
  /**
   * Sostituisce i percorsi mostrati. La usa anche il ricalcolo durante la
   * navigazione, cosi' il nuovo percorso passa dalla stessa rifinitura dei
   * tratti a piedi di quello calcolato all'inizio.
   */
  replaceRoutes: (routes: Route[], selectedId?: string | null) => void;
  selectRoute: (id: string | null) => void;
  clearRoutes: () => void;
  /**
   * Ripristina un itinerario letto da un file salvato. Non ricalcola nulla:
   * mostra il percorso com'era al momento del salvataggio.
   */
  importItinerary: (itinerary: ItineraryFile) => void;
  toggleLayer: (key: keyof LayerVisibility) => void;
  toggleOnlyAlongRoute: () => void;
  addReport: (report: UserReport) => void;
  removeReport: (id: string) => void;
  importReports: (incoming: UserReport[]) => number;
  setFocusPoint: (point: LngLat | null) => void;
  setHighlightedLine: (lineId: string | null) => void;
  setPickingMode: (mode: 'origin' | 'destination' | 'report' | null) => void;
}

/**
 * Contatore delle rifiniture in corso. La rifinitura dei tratti a piedi e'
 * asincrona: quando arriva, i percorsi mostrati potrebbero essere gia' altri
 * (nuovo calcolo, ricalcolo in navigazione). Il gettone scarta i risultati
 * arrivati in ritardo invece di farli sovrascrivere quelli attuali.
 */
let refineToken = 0;

export const useAppStore = create<AppState>((set, get) => ({
  phase: 'idle',
  error: null,
  data: null,
  graphIndex: null,
  router: null,
  geocoder: null,

  origin: null,
  destination: null,
  preferredLineId: null,

  routes: [],
  selectedRouteId: null,
  routingError: null,
  calculating: false,

  layers: DEFAULT_LAYERS,
  onlyAlongRoute: false,
  reports: loadReports(),
  reportsPersisted: true,
  focusPoint: null,
  highlightedLineId: null,
  pickingMode: null,

  async init() {
    if (get().phase !== 'idle' && get().phase !== 'error') return;
    set({ phase: 'loading-data', error: null });
    try {
      const data = await loadProjectData();
      set({ data, phase: 'loading-graph' });

      const graph = await loadRoutingGraph();
      const graphIndex = new RoutingGraphIndex(graph);
      const router = new BicipolitanaRouter(graphIndex, data.linesById);

      const streets = streetIndexFromGraph(graph.edges);
      const local = new LocalGeocodingProvider(data.pois, data.lines, streets);
      const geocoder = new CompositeGeocodingProvider([local, new NominatimProvider()]);

      set({ graphIndex, router, geocoder, phase: 'ready' });
    } catch (error) {
      set({
        phase: 'error',
        error:
          error instanceof Error
            ? `Non è stato possibile caricare i dati del progetto. ${error.message}`
            : 'Non è stato possibile caricare i dati del progetto.',
      });
    }
  },

  setOrigin(location) {
    refineToken += 1;
    set({ origin: location, routes: [], selectedRouteId: null, routingError: null });
  },

  setDestination(location) {
    refineToken += 1;
    set({ destination: location, routes: [], selectedRouteId: null, routingError: null });
  },

  swapEndpoints() {
    const { origin, destination } = get();
    refineToken += 1;
    set({
      origin: destination,
      destination: origin,
      routes: [],
      selectedRouteId: null,
      routingError: null,
    });
  },

  setPreferredLine(lineId) {
    set({ preferredLineId: lineId });
  },

  calculateRoutes(profiles) {
    const { router, origin, destination, preferredLineId } = get();
    if (!router) {
      set({ routingError: 'Il motore di calcolo non è ancora pronto. Attendi qualche istante.' });
      return;
    }
    if (!origin || !destination) {
      set({ routingError: 'Indica sia il punto di partenza sia la destinazione.' });
      return;
    }

    set({ calculating: true, routingError: null });
    try {
      const routes = router.route({
        origin: [origin.lng, origin.lat],
        destination: [destination.lng, destination.lat],
        destinationLabel: destination.label,
        profiles: profiles ?? DEFAULT_PROFILE_ORDER,
        preferredLineId,
      });
      get().replaceRoutes(routes, routes[0]?.id ?? null);
      set({ calculating: false, routingError: null });
    } catch (error) {
      const message =
        error instanceof RoutingError
          ? error.message
          : 'Si è verificato un problema nel calcolo del percorso. Riprova.';
      refineToken += 1;
      set({ routes: [], selectedRouteId: null, calculating: false, routingError: message });
    }
  },

  replaceRoutes(routes, selectedId) {
    set({
      routes,
      selectedRouteId:
        selectedId !== undefined ? selectedId : (routes[0]?.id ?? null),
    });

    // I percorsi si mostrano subito con il collegamento a piedi calcolato
    // offline; quando la rete pedonale risponde, il tratto viene ridisegnato
    // sulle strade. L'attesa non blocca la comparsa del risultato.
    const token = (refineToken += 1);
    void refineRoutes(routes).then((refined) => {
      if (token !== refineToken) return;
      const byId = new Map(refined.map((route) => [route.id, route]));
      set((state) => {
        const aggiornati = state.routes.map((route) => byId.get(route.id) ?? route);
        /*
         * Sulle strade reali un raccordo in linea d'aria puo' raddoppiare: un
         * percorso che prima dichiarava un quarto d'ora ne dichiara ora
         * quaranta minuti. L'ordine calcolato prima della rifinitura non
         * descrive piu' questi percorsi, e lasciarlo com'era significherebbe
         * mostrare per primo un giro che nel frattempo e' diventato il peggiore.
         */
        const ordinati = orderRoutes(aggiornati);
        /*
         * La selezione segue il nuovo ordine solo se era quella automatica —
         * il primo percorso, che nessuno ha ancora toccato. Se chi guarda ne
         * ha scelto un altro, quella scelta resta: cambiargli il percorso sotto
         * gli occhi perche' e' arrivata una risposta dalla rete non e' una cosa
         * che l'applicazione puo' fare.
         */
        const sceltaAutomatica = state.selectedRouteId === state.routes[0]?.id;
        return {
          routes: ordinati,
          selectedRouteId: sceltaAutomatica
            ? (ordinati[0]?.id ?? state.selectedRouteId)
            : state.selectedRouteId,
        };
      });
    });
  },

  selectRoute(id) {
    set({ selectedRouteId: id });
  },

  clearRoutes() {
    refineToken += 1;
    set({ routes: [], selectedRouteId: null, routingError: null });
  },

  importItinerary(itinerary) {
    /*
     * Il gettone sale senza avviare una nuova rifinitura: il percorso salvato
     * ha gia' i suoi tratti a piedi, ricalcolarli lo farebbe cambiare sotto
     * gli occhi di chi lo ha appena riaperto. Serve solo a scartare una
     * rifinitura ancora in volo dal calcolo precedente.
     */
    refineToken += 1;

    const route: Route = {
      ...itinerary.route,
      imported: true,
      importedAt: itinerary.savedAt,
    };

    set({
      origin: itinerary.origin,
      destination: itinerary.destination,
      routes: [route],
      selectedRouteId: route.id,
      routingError: null,
      calculating: false,
      pickingMode: null,
    });
  },

  toggleLayer(key) {
    set((state) => ({ layers: { ...state.layers, [key]: !state.layers[key] } }));
  },

  toggleOnlyAlongRoute() {
    set((state) => ({ onlyAlongRoute: !state.onlyAlongRoute }));
  },

  /*
   * Le tre azioni sulle segnalazioni scrivono subito nel deposito locale: se
   * il salvataggio non riesce lo stato lo registra, cosi' l'interfaccia puo'
   * dire che quella segnalazione non sopravvivera' alla chiusura della
   * pagina invece di lasciarlo credere.
   */
  addReport(report) {
    set((state) => {
      const reports = [report, ...state.reports];
      return { reports, reportsPersisted: saveReports(reports) };
    });
  },

  removeReport(id) {
    set((state) => {
      const reports = state.reports.filter((r) => r.id !== id);
      return { reports, reportsPersisted: saveReports(reports) };
    });
  },

  importReports(incoming) {
    const { reports, added } = mergeReports(get().reports, incoming);
    set({ reports, reportsPersisted: saveReports(reports) });
    return added;
  },

  setFocusPoint(point) {
    set({ focusPoint: point });
  },

  setHighlightedLine(lineId) {
    set({ highlightedLineId: lineId });
  },

  setPickingMode(mode) {
    set({ pickingMode: mode });
  },
}));

/** Percorso attualmente selezionato. */
export const useSelectedRoute = (): Route | null => {
  const routes = useAppStore((s) => s.routes);
  const id = useAppStore((s) => s.selectedRouteId);
  return routes.find((r) => r.id === id) ?? routes[0] ?? null;
};
