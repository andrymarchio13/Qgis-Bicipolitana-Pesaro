/**
 * Caricamento dei dati del progetto.
 *
 * Tutti i file provengono dalla pipeline Python (`npm run data`) e sono
 * serviti come file statici: l'applicazione non ha un backend.
 */
import { dataUrl } from '../config';
import type {
  Incident,
  Line,
  LinesFile,
  Poi,
  PoiKind,
  ProjectMetadata,
  RoutingGraph,
} from '../types';

export interface GeoJsonFeature {
  type: 'Feature';
  id?: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

export interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface ProjectData {
  lines: Line[];
  linesById: Map<string, Line>;
  linesGeoJson: GeoJsonCollection;
  cycleRoadsGeoJson: GeoJsonCollection;
  pois: Poi[];
  services: Poi[];
  obstacles: Poi[];
  leisure: Poi[];
  metadata: ProjectMetadata;
  incidents: Incident[];
}

async function fetchJson<T>(file: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(dataUrl(file), { signal });
  if (!response.ok) {
    throw new Error(`Impossibile caricare ${file} (errore ${response.status}).`);
  }
  return (await response.json()) as T;
}

function toPoi(feature: GeoJsonFeature, kind: PoiKind): Poi | null {
  if (feature.geometry?.type !== 'Point') return null;
  const coords = feature.geometry.coordinates as [number, number];
  const props = feature.properties as Record<string, unknown>;
  return {
    id: String(props.id ?? feature.id ?? ''),
    kind,
    category: props.category as Poi['category'],
    categoryLabel: String(props.categoryLabel ?? ''),
    name: (props.name as string | null) ?? null,
    osmId: (props.osmId as string | null) ?? null,
    lng: coords[0],
    lat: coords[1],
    tags: (props.tags as Record<string, string>) ?? {},
    bicycleAccess: (props.bicycleAccess as string | null) ?? null,
    bicycleAccessLabel: props.bicycleAccessLabel as string | undefined,
    maxWidthMeters: (props.maxWidthMeters as string | null) ?? null,
  };
}

/** Carica tutto tranne il grafo di routing, che è il file più pesante. */
export async function loadProjectData(signal?: AbortSignal): Promise<ProjectData> {
  const [linesFile, linesGeoJson, cycleRoads, services, obstacles, leisure, metadata] =
    await Promise.all([
      fetchJson<LinesFile>('lines.json', signal),
      fetchJson<GeoJsonCollection>('linee_bicipolitana.geojson', signal),
      fetchJson<GeoJsonCollection>('strade.geojson', signal),
      fetchJson<GeoJsonCollection>('servizi.geojson', signal),
      fetchJson<GeoJsonCollection>('ostacoli.geojson', signal),
      fetchJson<GeoJsonCollection>('svago.geojson', signal),
      fetchJson<ProjectMetadata>('metadata.json', signal),
    ]);

  const servicePois = services.features
    .map((f) => toPoi(f, 'servizio'))
    .filter((p): p is Poi => p !== null);
  const obstaclePois = obstacles.features
    .map((f) => toPoi(f, 'ostacolo'))
    .filter((p): p is Poi => p !== null);
  const leisurePois = leisure.features
    .map((f) => toPoi(f, 'svago'))
    .filter((p): p is Poi => p !== null);

  // Gli incidenti sono opzionali e vengono mostrati solo se il file esiste e
  // ogni voce dichiara una fonte verificabile.
  let incidents: Incident[] = [];
  try {
    const raw = await fetchJson<{ incidents: Incident[] }>('incidents.json', signal);
    incidents = (raw.incidents ?? []).filter((i) => Boolean(i.source));
  } catch {
    incidents = [];
  }

  return {
    lines: linesFile.lines,
    linesById: new Map(linesFile.lines.map((l) => [l.id, l])),
    linesGeoJson,
    cycleRoadsGeoJson: cycleRoads,
    pois: [...servicePois, ...obstaclePois, ...leisurePois],
    services: servicePois,
    obstacles: obstaclePois,
    leisure: leisurePois,
    metadata,
    incidents,
  };
}

/** Carica il grafo di routing (≈2,3 MB, ≈440 KB compressi). */
export async function loadRoutingGraph(signal?: AbortSignal): Promise<RoutingGraph> {
  return fetchJson<RoutingGraph>('graph.json', signal);
}
