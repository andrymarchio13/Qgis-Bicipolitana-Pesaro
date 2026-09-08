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
import { RoutingGraphIndex } from '../services/routing/graph';
import { BicipolitanaRouter, RoutingError } from '../services/routing/router';
import { refineRoutes } from '../services/routing/walk';
import type {
  GeocodingProvider,
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
  highlightedLineId: string | null;

  /** Punto che l'utente sta scegliendo cliccando sulla mappa. */
  pickingMode: 'origin' | 'destination' | null;

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
  toggleLayer: (key: keyof LayerVisibility) => void;
  setHighlightedLine: (lineId: string | null) => void;
  setPickingMode: (mode: 'origin' | 'destination' | null) => void;
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
      set((state) => ({ routes: state.routes.map((route) => byId.get(route.id) ?? route) }));
    });
  },

  selectRoute(id) {
    set({ selectedRouteId: id });
  },

  clearRoutes() {
    refineToken += 1;
    set({ routes: [], selectedRouteId: null, routingError: null });
  },

  toggleLayer(key) {
    set((state) => ({ layers: { ...state.layers, [key]: !state.layers[key] } }));
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
