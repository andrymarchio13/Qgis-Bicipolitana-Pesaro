/** Utilità condivise dai test: caricano i dati reali generati dalla pipeline. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { LinesFile, ProjectMetadata, RoutingGraph } from '../src/types';

const root = resolve(__dirname, '..');

export const readJson = <T>(relative: string): T =>
  JSON.parse(readFileSync(resolve(root, relative), 'utf-8')) as T;

export const graph = (): RoutingGraph => readJson<RoutingGraph>('public/data/graph.json');

export const linesFile = (): LinesFile => readJson<LinesFile>('public/data/lines.json');

export const metadata = (): ProjectMetadata => readJson<ProjectMetadata>('public/data/metadata.json');

export interface GeoJsonCollection {
  type: string;
  features: {
    type: string;
    id?: string;
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }[];
}

export const geojson = (name: string): GeoJsonCollection =>
  readJson<GeoJsonCollection>(`public/data/${name}`);

/**
 * Punti di riferimento per i test di percorso.
 *
 * Non sono coordinate inventate: ognuna è presa da un elemento realmente
 * presente nei dati del progetto (una via nominata nel grafo OSM o un POI del
 * GeoPackage), così che i test verifichino il routing e non la fortuna
 * nell'aver indovinato un punto su strada.
 */
export const PLACES = {
  /** Viale Trieste — lungomare, dal grafo OSM. */
  lungomareTrieste: [12.92248, 43.91052] as [number, number],
  /** Piazzale della Libertà — dal grafo OSM. */
  piazzaleLiberta: [12.91802, 43.91443] as [number, number],
  /** Viale della Vittoria — dal grafo OSM. */
  vialeVittoria: [12.90872, 43.91704] as [number, number],
  /** POI "Parcheggio scambiatore San Decenzio" — da servizi.geojson. */
  parcheggioSanDecenzio: [12.913568, 43.903381] as [number, number],
  /** POI "Velomarche" (officina) — da servizi.geojson. */
  velomarche: [12.897335, 43.910429] as [number, number],
  /** POI "Copparo Bike Pesaro" — da servizi.geojson. */
  copparoBike: [12.893514, 43.895993] as [number, number],
  /** Pista ciclopedonale Umberto Cardinali — dal grafo OSM. */
  pistaCardinali: [12.87932, 43.90857] as [number, number],
  /** Strada Panoramica Ardizio — dal grafo OSM. */
  panoramicaArdizio: [12.94284, 43.89113] as [number, number],
  /** Via Solferino — dal grafo OSM. */
  viaSolferino: [12.88908, 43.89203] as [number, number],
};

/**
 * Punti scelti fuori dall'area coperta dai dati: servono a verificare che il
 * percorso non venga rifiutato ma raccordato alla rete con un tratto a piedi.
 * Non ricadono in `PESARO_BOUNDS`, quindi restano fuori da `PLACES`.
 */
export const PLACES_FUORI_RETE = {
  /**
   * Verso Case Bruciate, a ovest di Pesaro: circa 1,2 km dalla rete coperta
   * dai dati, quindi oltre il raggio di aggancio diretto.
   */
  caseBruciate: [12.82918, 43.88528] as [number, number],
};
