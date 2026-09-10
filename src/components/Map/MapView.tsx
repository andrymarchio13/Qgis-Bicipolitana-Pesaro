/**
 * Mappa dell'applicazione (MapLibre GL JS).
 *
 * Scelta tecnica motivata nel README: MapLibre rende su GPU migliaia di
 * geometrie senza degrado, espone rotazione e inclinazione necessarie alla
 * modalità navigazione, ed è indipendente da provider proprietari.
 */
import maplibregl, { type LngLatBoundsLike, type MapGeoJSONFeature } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_RASTER,
  BASEMAP_STYLE_URL,
  GLYPHS_URL,
  MAP_DEFAULT_ZOOM,
  MAP_LABEL_FONT,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  PESARO_CENTER,
} from '../../config';
import { POI_EMOJI, POI_KIND_COLOR } from '../../config/poi';
import type { LngLat, Poi, Route } from '../../types';
import { boundsOf } from '../../utils/geo';
import { useAppStore, LAYER_CATEGORIES } from '../../store/useAppStore';
import type { UserPosition } from '../../hooks/useLocation';
import {
  createCyclistMarker,
  CYCLIST_ICON_ID,
  CYCLIST_PIXEL_RATIO,
  type CyclistMarker,
} from './cyclistMarker';

import 'maplibre-gl/dist/maplibre-gl.css';

export interface MapViewProps {
  route: Route | null;
  otherRoutes?: Route[];
  userPosition?: UserPosition | null;
  /** Posizione agganciata al percorso durante la navigazione. */
  snappedPosition?: LngLat | null;
  /**
   * Pallino verde del punto di partenza. In navigazione va spento: la partenza
   * coincide con la posizione dell'utente, e disegnarli entrambi mostrerebbe
   * due pallini verdi in punti diversi della mappa.
   */
  showOrigin?: boolean;
  followUser?: boolean;
  bearing?: number | null;
  /**
   * Mostra la posizione come ciclista animato invece che come pallino. Si
   * accende in navigazione: fuori di li' non c'e' una direzione di marcia da
   * rappresentare, e un ciclista fermo su una mappa ferma sarebbe un fregio.
   */
  cyclist?: boolean;
  /** Direzione di marcia in gradi, per orientare il ciclista. */
  course?: number | null;
  /** Velocita' in m/s: regola la cadenza della pedalata. */
  speed?: number | null;
  onMapClick?: (point: LngLat) => void;
  onPoiClick?: (poi: Poi) => void;
  /** Gruppo di POI che non si scioglie oltre: va mostrato come elenco. */
  onClusterClick?: (pois: Poi[], at: LngLat) => void;
  onLineClick?: (lineId: string) => void;
  /** Scelta di un'alternativa toccandola sulla mappa. */
  onRouteSelect?: (routeId: string) => void;
  fitTo?: LngLatBoundsLike | null;
  /**
   * Porzione di mappa coperta dall'interfaccia (in pixel). Serve a centrare
   * percorsi e linee nella parte realmente visibile invece che dietro al
   * pannello: senza questo, su schermo stretto il percorso finisce sotto il
   * foglio scorrevole.
   */
  obscured?: { top?: number; right?: number; bottom?: number; left?: number };
  interactive?: boolean;
  /** Se false, evidenziare una linea non sposta l'inquadratura. */
  zoomToHighlighted?: boolean;
}

const SOURCE = {
  lines: 'bicipolitana-lines',
  cycle: 'cycle-roads',
  pois: 'pois',
  route: 'route',
  alternatives: 'route-alternatives',
  endpoints: 'endpoints',
  user: 'user-position',
};

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

/**
 * Emoji come icone della mappa.
 *
 * MapLibre disegna il testo dei livelli `symbol` a partire da glifi SDF in
 * scala di grigi: le emoji a colori non fanno parte dei font serviti e non
 * verrebbero disegnate affatto. Si convertono quindi in immagini con un
 * canvas — dove il sistema le rende a colori — e si registrano come icone.
 */
const EMOJI_ICON_SIZE = 48;

function emojiToIcon(emoji: string): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = EMOJI_ICON_SIZE;
  canvas.height = EMOJI_ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font =
    `${Math.round(EMOJI_ICON_SIZE * 0.74)}px "Apple Color Emoji","Segoe UI Emoji",` +
    '"Noto Color Emoji","Twemoji Mozilla",sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(emoji, EMOJI_ICON_SIZE / 2, EMOJI_ICON_SIZE / 2 + EMOJI_ICON_SIZE * 0.06);
  return context.getImageData(0, 0, EMOJI_ICON_SIZE, EMOJI_ICON_SIZE);
}

/** Nome dell'icona registrata per una categoria di POI. */
export const iconIdFor = (category: string): string => `poi-${category}`;

function registerEmojiIcons(instance: maplibregl.Map): void {
  for (const [category, emoji] of Object.entries(POI_EMOJI)) {
    const id = iconIdFor(category);
    if (instance.hasImage(id)) continue;
    const image = emojiToIcon(emoji);
    // pixelRatio 2: l'icona da 48 px viene mostrata a 24 px, nitida anche
    // sugli schermi ad alta densita'.
    if (image) instance.addImage(id, image, { pixelRatio: 2 });
  }
}

/**
 * Registra il ciclista animato della posizione.
 *
 * Il riferimento serve dopo: la cadenza della pedalata va aggiornata a ogni
 * punto GPS, e per farlo occorre l'oggetto che sta disegnando i fotogrammi.
 */
function registerCyclistIcon(
  instance: maplibregl.Map,
  holder: { current: CyclistMarker | null },
): void {
  if (instance.hasImage(CYCLIST_ICON_ID)) return;
  const marker = createCyclistMarker();
  if (!marker) return;
  holder.current = marker;
  instance.addImage(CYCLIST_ICON_ID, marker, { pixelRatio: CYCLIST_PIXEL_RATIO });
}

/**
 * Stile raster di ripiego, usato se lo stile vettoriale non e' raggiungibile.
 * Mantiene la mappa utilizzabile anche con il provider principale offline.
 */
function rasterStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [BASEMAP_RASTER.url],
        tileSize: BASEMAP_RASTER.tileSize,
        maxzoom: BASEMAP_RASTER.maxZoom,
        attribution: BASEMAP_ATTRIBUTION,
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}


export function MapView({
  route,
  otherRoutes = [],
  userPosition,
  snappedPosition,
  showOrigin = true,
  followUser = false,
  bearing = null,
  cyclist = false,
  course = null,
  speed = null,
  onMapClick,
  onPoiClick,
  onClusterClick,
  onLineClick,
  onRouteSelect,
  fitTo,
  obscured,
  interactive = true,
  zoomToHighlighted = true,
}: MapViewProps): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const popup = useRef<maplibregl.Popup | null>(null);
  const fallbackApplied = useRef(false);
  const cyclistMarker = useRef<CyclistMarker | null>(null);

  const data = useAppStore((s) => s.data);
  const layers = useAppStore((s) => s.layers);
  const highlightedLineId = useAppStore((s) => s.highlightedLineId);
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);

  /** Margini della vista: il minimo tecnico piu' la parte coperta dall'UI. */
  const viewportPadding = useMemo(
    () => ({
      top: 24 + (obscured?.top ?? 0),
      right: 24 + (obscured?.right ?? 0),
      bottom: 24 + (obscured?.bottom ?? 0),
      left: 24 + (obscured?.left ?? 0),
    }),
    [obscured?.top, obscured?.right, obscured?.bottom, obscured?.left],
  );

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE_URL || rasterStyle(),
      center: PESARO_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      interactive,
      attributionControl: false,
    });

    instance.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: BASEMAP_ATTRIBUTION }),
      'bottom-right',
    );
    if (interactive) {
      instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
      instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    }

    const installLayers = (): void => {
      if (instance.getSource(SOURCE.lines)) return;
      ready.current = true;

      registerEmojiIcons(instance);
      registerCyclistIcon(instance, cyclistMarker);

      instance.addSource(SOURCE.cycle, { type: 'geojson', data: EMPTY_FC });
      instance.addSource(SOURCE.lines, { type: 'geojson', data: EMPTY_FC });
      instance.addSource(SOURCE.alternatives, { type: 'geojson', data: EMPTY_FC });
      instance.addSource(SOURCE.route, { type: 'geojson', data: EMPTY_FC });
      instance.addSource(SOURCE.endpoints, { type: 'geojson', data: EMPTY_FC });
      instance.addSource(SOURCE.user, { type: 'geojson', data: EMPTY_FC });
      instance.addSource(SOURCE.pois, {
        type: 'geojson',
        data: EMPTY_FC,
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 14,
      });

      // Rete ciclabile OSM di supporto
      instance.addLayer({
        id: 'cycle-roads',
        type: 'line',
        source: SOURCE.cycle,
        paint: {
          'line-color': '#0ea5e9',
          'line-width': 1.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.55,
        },
      });

      // Linee Bicipolitana: alone bianco + tratto colorato
      instance.addLayer({
        id: 'lines-halo',
        type: 'line',
        source: SOURCE.lines,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9],
          'line-opacity': 0.85,
        },
      });
      instance.addLayer({
        id: 'lines',
        type: 'line',
        source: SOURCE.lines,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 5.5],
          // L'evidenziazione di una linea viene applicata con setPaintProperty
          // nell'effetto dedicato, non con feature-state.
          'line-opacity': 0.95,
        },
      });
      instance.addLayer({
        id: 'lines-label',
        type: 'symbol',
        source: SOURCE.lines,
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'lineId'],
          'text-size': 12,
          'text-font': MAP_LABEL_FONT,
          'symbol-spacing': 220,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });

      // --- Percorsi -----------------------------------------------------
      /*
       * Le alternative restano dietro al percorso scelto, ma devono essere
       * visibili: erano disegnate al 35% di opacita' in grigio, cioe' quasi
       * indistinguibili dallo sfondo della mappa, e chi guardava concludeva
       * che il percorso trovato fosse uno solo.
       *
       * Ora sono tratteggiate — il tratteggio dice "non e' questo il percorso
       * attivo" senza doverle spegnere — con un bordo chiaro che le stacca
       * dalle strade sottostanti.
       */
      instance.addLayer({
        id: 'alternatives-casing',
        type: 'line',
        source: SOURCE.alternatives,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.7 },
      });
      instance.addLayer({
        id: 'alternatives',
        type: 'line',
        source: SOURCE.alternatives,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#64748b',
          'line-width': 4,
          'line-opacity': 0.9,
          'line-dasharray': [2.5, 1.6],
        },
      });
      /*
       * Corsia di tocco: la linea disegnata e' larga quattro pixel, che su
       * schermo tattile non si centrano. Questa e' trasparente e larga
       * abbastanza da poterci puntare il dito.
       */
      instance.addLayer({
        id: 'alternatives-hit',
        type: 'line',
        source: SOURCE.alternatives,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000000', 'line-width': 22, 'line-opacity': 0 },
      });
      // Alone luminoso: sfocato e pulsante, e' cio' che stacca il percorso
      // dal resto della rete anche dove i colori coincidono.
      instance.addLayer({
        id: 'route-glow',
        type: 'line',
        source: SOURCE.route,
        filter: ['!=', ['get', 'mode'], 'piedi'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 16, 16, 30],
          'line-blur': 12,
          'line-opacity': 0,
        },
      });
      instance.addLayer({
        id: 'route-casing',
        type: 'line',
        source: SOURCE.route,
        filter: ['!=', ['get', 'mode'], 'piedi'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 15],
        },
      });
      instance.addLayer({
        id: 'route',
        type: 'line',
        source: SOURCE.route,
        filter: ['!=', ['get', 'mode'], 'piedi'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 10],
        },
      });
      /*
       * Tratti a piedi: collegano il punto scelto alla rete coperta dai dati.
       * Tratteggio tondo e colore neutro perche' non sono un percorso
       * calcolato ma un collegamento in linea d'aria.
       */
      instance.addLayer({
        id: 'route-walk-casing',
        type: 'line',
        source: SOURCE.route,
        filter: ['==', ['get', 'mode'], 'piedi'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 11],
        },
      });
      instance.addLayer({
        id: 'route-walk',
        type: 'line',
        source: SOURCE.route,
        filter: ['==', ['get', 'mode'], 'piedi'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 6],
          'line-dasharray': [0, 1.9],
        },
      });
      // Tratteggio bianco che scorre nel verso di marcia: mostra la direzione
      // senza aggiungere simboli sulla mappa.
      instance.addLayer({
        id: 'route-flow',
        type: 'line',
        source: SOURCE.route,
        filter: ['!=', ['get', 'mode'], 'piedi'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 5],
          'line-opacity': 0.9,
          'line-dasharray': [0, 4, 3],
        },
      });

      // --- POI ----------------------------------------------------------
      instance.addLayer({
        id: 'poi-clusters',
        type: 'circle',
        source: SOURCE.pois,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#0f6b45',
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 25, 26],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
      instance.addLayer({
        id: 'poi-cluster-count',
        type: 'symbol',
        source: SOURCE.pois,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 13,
          'text-font': MAP_LABEL_FONT,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });
      // Pastiglia bianca dietro l'emoji: rende il simbolo leggibile su
      // qualsiasi sfondo e mantiene un'area di tocco ampia.
      instance.addLayer({
        id: 'poi-points',
        type: 'circle',
        source: SOURCE.pois,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 12, 17, 15],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['get', 'markerColor'],
        },
      });
      instance.addLayer({
        id: 'poi-glyph',
        type: 'symbol',
        source: SOURCE.pois,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.45, 14, 0.7, 17, 0.95],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // Origine / destinazione
      instance.addLayer({
        id: 'endpoints',
        type: 'circle',
        source: SOURCE.endpoints,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 8,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });

      /*
       * Posizione utente. Due rappresentazioni sulla stessa sorgente: il
       * pallino sulla mappa normale, dove non c'e' una marcia in corso, e il
       * ciclista animato in navigazione. Il filtro sceglie quale disegnare,
       * cosi' non se ne vedono mai due sovrapposti.
       */
      instance.addLayer({
        id: 'user-dot',
        type: 'circle',
        source: SOURCE.user,
        filter: ['all', ['==', ['get', 'kind'], 'position'], ['!', ['get', 'rider']]],
        paint: {
          'circle-color': '#1ba26d',
          'circle-radius': 8,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });

      instance.addLayer({
        id: 'user-cyclist',
        type: 'symbol',
        source: SOURCE.user,
        filter: ['all', ['==', ['get', 'kind'], 'position'], ['get', 'rider']],
        layout: {
          'icon-image': CYCLIST_ICON_ID,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 16, 1, 19, 1.25],
          'icon-rotate': ['get', 'course'],
          // L'icona e' disegnata vista dall'alto: deve girare con la mappa e
          // coricarsi con essa quando la vista e' inclinata, altrimenti a
          // mappa ruotata indicherebbe una direzione che non e' quella vera.
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      /*
       * Tempo stimato di ogni alternativa, scritto sulla linea.
       *
       * Sta in fondo all'elenco dei livelli perche' il testo deve restare
       * leggibile sopra qualsiasi cosa passi li' sotto. Senza il tempo, due
       * linee tratteggiate parallele non dicono perche' si dovrebbe
       * preferire l'una o l'altra.
       */
      instance.addLayer({
        id: 'alternatives-label',
        type: 'symbol',
        source: SOURCE.alternatives,
        minzoom: 11,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-font': MAP_LABEL_FONT,
          'text-size': 12,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    };

    instance.on('load', installLayers);
    // Se lo stile vettoriale non e' raggiungibile si passa allo stile raster:
    // la mappa resta usabile anche con il provider principale offline.
    instance.on('error', (event) => {
      const message = String(event?.error?.message ?? '');
      const styleFailed =
        !instance.getSource(SOURCE.lines) &&
        (message.includes('style') || message.includes('Failed to fetch'));
      if (!styleFailed || fallbackApplied.current) return;
      fallbackApplied.current = true;
      instance.setStyle(rasterStyle());
      instance.once('styledata', installLayers);
    });

    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------- eventi
  useEffect(() => {
    const instance = map.current;
    if (!instance || !interactive) return;

    const handleClick = (event: maplibregl.MapMouseEvent): void => {
      const layers = ['poi-points', 'poi-clusters', 'alternatives-hit', 'lines'].filter(
        (id) => instance.getLayer(id),
      );
      const features = instance.queryRenderedFeatures(event.point, { layers });
      const hit = features[0] as MapGeoJSONFeature | undefined;

      if (hit?.layer.id === 'poi-clusters') {
        const clusterId = hit.properties?.cluster_id as number;
        const source = instance.getSource(SOURCE.pois) as maplibregl.GeoJSONSource;
        const centre = (hit.geometry as GeoJSON.Point).coordinates as [number, number];

        // Si apre esattamente allo zoom che scioglie il gruppo, così i
        // simboli dei singoli punti diventano subito visibili.
        void source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            const target = Math.min(zoom, MAP_MAX_ZOOM);
            if (target > instance.getZoom() + 0.2) {
              instance.easeTo({ center: centre, zoom: target, duration: 600 });
              return;
            }
            // Il gruppo non si scioglie oltre (punti quasi sovrapposti):
            // si elencano i suoi contenuti invece di zoomare a vuoto.
            void source.getClusterLeaves(clusterId, 25, 0).then((leaves) => {
              const ids = leaves.map((leaf) => String(leaf.properties?.id));
              const pois = (data?.pois ?? []).filter((p) => ids.includes(p.id));
              if (pois.length > 0) onClusterClick?.(pois, centre);
            });
          })
          .catch(() => {
            instance.easeTo({ center: centre, zoom: instance.getZoom() + 2 });
          });
        return;
      }
      if (hit?.layer.id === 'poi-points') {
        const id = hit.properties?.id as string;
        const poi = data?.pois.find((p) => p.id === id);
        if (poi) onPoiClick?.(poi);
        return;
      }
      /*
       * Toccare un'alternativa la sceglie. E' il gesto che ci si aspetta da
       * una mappa con piu' percorsi disegnati, e senza di esso le linee
       * tratteggiate sarebbero un disegno e basta: per cambiare percorso
       * bisognerebbe cercare la scheda corrispondente nel pannello.
       */
      if (hit?.layer.id === 'alternatives-hit') {
        const routeId = hit.properties?.id as string;
        if (routeId) onRouteSelect?.(routeId);
        return;
      }
      if (hit?.layer.id === 'lines') {
        const lineId = hit.properties?.lineId as string;
        if (lineId) onLineClick?.(lineId);
        return;
      }
      onMapClick?.([event.lngLat.lng, event.lngLat.lat]);
    };

    const setPointer = (): void => {
      instance.getCanvas().style.cursor = 'pointer';
    };
    const resetPointer = (): void => {
      instance.getCanvas().style.cursor = '';
    };

    const hoverable = ['poi-points', 'poi-clusters', 'alternatives-hit', 'lines'];
    instance.on('click', handleClick);
    for (const layer of hoverable) {
      instance.on('mouseenter', layer, setPointer);
      instance.on('mouseleave', layer, resetPointer);
    }

    return () => {
      instance.off('click', handleClick);
      for (const layer of hoverable) {
        instance.off('mouseenter', layer, setPointer);
        instance.off('mouseleave', layer, resetPointer);
      }
    };
  }, [data, interactive, onMapClick, onPoiClick, onClusterClick, onLineClick, onRouteSelect]);

  // --------------------------------------------------------------- dati
  const setData = useCallback((id: string, value: GeoJSON.FeatureCollection) => {
    const source = map.current?.getSource(id) as maplibregl.GeoJSONSource | undefined;
    source?.setData(value);
  }, []);

  const visiblePois = useMemo(() => {
    if (!data) return [];
    const allowed = new Set<string>();
    for (const [key, categories] of Object.entries(LAYER_CATEGORIES)) {
      if (layers[key as keyof typeof layers] && categories) {
        for (const c of categories) allowed.add(c);
      }
    }
    return data.pois.filter((poi) => {
      if (poi.kind === 'servizio' && !layers.servizi) return false;
      return allowed.has(poi.category);
    });
  }, [data, layers]);

  useEffect(() => {
    if (!map.current) return;
    const apply = (): void => {
      if (!data) return;
      setData(SOURCE.lines, layers.linee ? (data.linesGeoJson as never) : EMPTY_FC);
      setData(SOURCE.cycle, layers.ciclabili ? (data.cycleRoadsGeoJson as never) : EMPTY_FC);
      setData(SOURCE.pois, {
        type: 'FeatureCollection',
        features: visiblePois.map((poi) => ({
          type: 'Feature' as const,
          properties: {
            id: poi.id,
            kind: poi.kind,
            category: poi.category,
            icon: iconIdFor(poi.category),
            markerColor: POI_KIND_COLOR[poi.kind],
          },
          geometry: { type: 'Point' as const, coordinates: [poi.lng, poi.lat] },
        })),
      });
    };
    if (ready.current) apply();
    else map.current.once('load', apply);
  }, [data, layers, visiblePois, setData]);

  // Evidenziare una linea porta la mappa sulla sua estensione.
  // L'opacita' dei livelli e' gestita dall'effetto di messa in evidenza piu'
  // sotto, che tiene conto anche del percorso attivo.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!highlightedLineId || !data || zoomToHighlighted === false) return;

    const feature = data.linesGeoJson.features.find(
      (f) => f.properties.lineId === highlightedLineId,
    );
    if (!feature) return;

    const apply = (): void => {
      const coordinates =
        feature.geometry.type === 'MultiLineString'
          ? (feature.geometry.coordinates as LngLat[][]).flat()
          : (feature.geometry.coordinates as LngLat[]);
      const bounds = boundsOf(coordinates);
      if (bounds) {
        instance.fitBounds(bounds, { padding: viewportPadding, maxZoom: 15, duration: 700 });
      }
    };

    // La mappa puo' non essere ancora pronta quando si apre direttamente
    // l'indirizzo di una linea: in quel caso si attende il caricamento.
    if (ready.current) apply();
    else instance.once('load', apply);
  }, [highlightedLineId, data, zoomToHighlighted, viewportPadding]);

  // Percorso attivo e alternative
  useEffect(() => {
    if (!map.current) return;
    const apply = (): void => {
      setData(SOURCE.alternatives, {
        type: 'FeatureCollection',
        features: otherRoutes
          .filter((r) => r.id !== route?.id && r.geometry.length > 1)
          .map((r) => ({
            type: 'Feature' as const,
            properties: { id: r.id, label: `${r.durationMinutes} min` },
            geometry: { type: 'LineString' as const, coordinates: r.geometry },
          })),
      });

      setData(SOURCE.route, {
        type: 'FeatureCollection',
        features: route
          ? route.segments.map((segment, i) => ({
              type: 'Feature' as const,
              properties: {
                color: segment.color,
                lineId: segment.lineId,
                mode: segment.kind,
                index: i,
              },
              geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
            }))
          : [],
      });
    };
    if (ready.current) apply();
    else map.current.once('load', apply);
  }, [route, otherRoutes, setData]);

  /*
   * Messa in evidenza del percorso consigliato.
   *
   * Tre effetti combinati, tutti a tempo:
   *   1. la rete e i POI vengono attenuati, così il percorso non si confonde
   *      con le linee che ha appena percorso;
   *   2. un lampo iniziale di circa un secondo segnala il percorso appena
   *      calcolato;
   *   3. dopo il lampo resta una pulsazione lenta dell'alone e un tratteggio
   *      che scorre nel verso di marcia.
   *
   * L'animazione viene disattivata se il sistema chiede meno movimento.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current || !instance.getLayer('route-glow')) return;

    const hasRoute = Boolean(route && route.geometry.length > 1);
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // 1. attenuazione del contorno
    const dim = hasRoute ? 0.28 : 1;
    if (instance.getLayer('lines')) {
      instance.setPaintProperty(
        'lines',
        'line-opacity',
        highlightedLineId
          ? ['case', ['==', ['get', 'lineId'], highlightedLineId], 1, 0.18]
          : 0.95 * dim,
      );
    }
    if (instance.getLayer('lines-halo')) {
      instance.setPaintProperty('lines-halo', 'line-opacity', 0.85 * dim);
    }
    // I punti di interesse restano leggibili: arretrano appena, perche'
    // servono proprio mentre si guarda il percorso (fontanelle, ostacoli).
    const poiDim = hasRoute ? 0.85 : 1;
    const POI_OPACITY: [string, string][] = [
      ['poi-points', 'circle-opacity'],
      ['poi-glyph', 'icon-opacity'],
      ['poi-clusters', 'circle-opacity'],
      ['poi-cluster-count', 'text-opacity'],
    ];
    for (const [id, property] of POI_OPACITY) {
      if (!instance.getLayer(id)) continue;
      instance.setPaintProperty(id, property, poiDim);
      if (property === 'circle-opacity') {
        instance.setPaintProperty(id, 'circle-stroke-opacity', poiDim);
      }
    }

    if (!hasRoute) {
      instance.setPaintProperty('route-glow', 'line-opacity', 0);
      return;
    }

    if (reduceMotion) {
      instance.setPaintProperty('route-glow', 'line-opacity', 0.35);
      return;
    }

    // 2 e 3. lampo iniziale, poi pulsazione e tratteggio in movimento
    const DASH_STEPS: [number, number, number][] = [
      [0, 4, 3],
      [1, 4, 2],
      [2, 4, 1],
      [3, 4, 0],
      [0, 1, 3, 3] as unknown as [number, number, number],
      [0, 2, 3, 2] as unknown as [number, number, number],
      [0, 3, 3, 1] as unknown as [number, number, number],
    ];
    const FLASH_MS = 1100;
    const PULSE_MS = 2600;

    const start = performance.now();
    let frame = 0;
    let lastDash = -1;

    const tick = (now: number): void => {
      if (!instance.getLayer('route-glow')) return;
      const elapsed = now - start;

      const flash = elapsed < FLASH_MS ? 1 - elapsed / FLASH_MS : 0;
      const pulse = 0.22 + 0.16 * (1 + Math.sin((elapsed / PULSE_MS) * Math.PI * 2)) * 0.5;
      instance.setPaintProperty('route-glow', 'line-opacity', Math.min(0.95, pulse + flash * 0.6));

      if (instance.getLayer('route-flow')) {
        const step = Math.floor(elapsed / 90) % DASH_STEPS.length;
        if (step !== lastDash) {
          lastDash = step;
          instance.setPaintProperty('route-flow', 'line-dasharray', DASH_STEPS[step]);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [route, highlightedLineId]);

  // Origine / destinazione
  useEffect(() => {
    if (!map.current) return;
    const apply = (): void => {
      const features: GeoJSON.Feature[] = [];
      if (origin && showOrigin) {
        features.push({
          type: 'Feature',
          properties: { color: '#1ba26d', role: 'origin' },
          geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] },
        });
      }
      if (destination) {
        features.push({
          type: 'Feature',
          properties: { color: '#b91c1c', role: 'destination' },
          geometry: { type: 'Point', coordinates: [destination.lng, destination.lat] },
        });
      }
      setData(SOURCE.endpoints, { type: 'FeatureCollection', features });
    };
    if (ready.current) apply();
    else map.current.once('load', apply);
  }, [origin, destination, showOrigin, setData]);

  // Posizione utente
  useEffect(() => {
    if (!map.current) return;
    const apply = (): void => {
      const point = snappedPosition ?? (userPosition ? [userPosition.lng, userPosition.lat] : null);
      if (!point) {
        setData(SOURCE.user, EMPTY_FC);
        return;
      }
      // Un solo segno di posizione: niente alone di precisione, che con la
      // posizione agganciata al percorso appariva come un secondo pallino.
      const features: GeoJSON.Feature[] = [
        {
          type: 'Feature',
          properties: {
            kind: 'position',
            rider: cyclist,
            // Senza direzione nota il ciclista punta verso l'alto della mappa
            // invece di ruotare a caso a ogni punto GPS impreciso.
            course: course ?? 0,
          },
          geometry: { type: 'Point', coordinates: point },
        },
      ];
      setData(SOURCE.user, { type: 'FeatureCollection', features });
    };
    if (ready.current) apply();
    else map.current.once('load', apply);
  }, [userPosition, snappedPosition, cyclist, course, setData]);

  // La pedalata segue la velocita' reale: da fermi il ciclista non pedala.
  useEffect(() => {
    cyclistMarker.current?.setSpeed(cyclist ? speed : null);
    // Ripartire da fermo non genera un nuovo fotogramma da solo: l'animazione
    // si e' spenta proprio per non tenere sveglia la mappa.
    if (cyclist && speed !== null) map.current?.triggerRepaint();
  }, [cyclist, speed]);

  // La mappa deve sapere quale parte di se' e' coperta dall'interfaccia.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const apply = (): void => {
      instance.setPadding(viewportPadding);
    };
    if (ready.current) apply();
    else instance.once('load', apply);
  }, [viewportPadding]);

  // Inquadratura
  useEffect(() => {
    if (!map.current || !fitTo) return;
    map.current.fitBounds(fitTo, {
      padding: viewportPadding,
      maxZoom: 16,
      duration: 600,
    });
  }, [fitTo, viewportPadding]);

  // Modalità inseguimento (navigazione)
  useEffect(() => {
    const instance = map.current;
    if (!instance || !followUser) return;
    const point = snappedPosition ?? (userPosition ? [userPosition.lng, userPosition.lat] : null);
    if (!point) return;
    instance.easeTo({
      center: point as [number, number],
      zoom: Math.max(instance.getZoom(), 16.5),
      bearing: bearing ?? instance.getBearing(),
      pitch: 45,
      duration: 700,
    });
  }, [followUser, userPosition, snappedPosition, bearing]);

  useEffect(
    () => () => {
      popup.current?.remove();
    },
    [],
  );

  return <div ref={container} className="map-root" role="application" aria-label="Mappa della Bicipolitana di Pesaro" />;
}
