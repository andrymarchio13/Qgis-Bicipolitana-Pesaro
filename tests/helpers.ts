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
  /** Viale del Risorgimento, zona stazione — dal grafo OSM. */
  vialeRisorgimento: [12.90845, 43.90691] as [number, number],
  /** Villa Ceccolini — dal grafo OSM, a una settantina di metri dalla rete. */
  villaCeccolini: [12.86, 43.883] as [number, number],
  /** Via del Miralfiore, lungo il parco — dal grafo OSM. */
  viaMiralfiore: [12.90422, 43.90323] as [number, number],
  /** Via Pompilio Fastiggi, quartiere Villa Fastiggi — dal grafo OSM. */
  villaFastiggi: [12.87726, 43.88491] as [number, number],
  /** Via Cattabrighe, estremita' nord-ovest della rete — dal grafo OSM. */
  cattabrighe: [12.86376, 43.91636] as [number, number],
  /** Via Santa Maria Fabbrecce — dal grafo OSM. */
  santaMariaFabbrecce: [12.8738, 43.91024] as [number, number],
  /** Via per Soria — dal grafo OSM. */
  viaPerSoria: [12.89843, 43.91524] as [number, number],
  /** Via Pantano — dal grafo OSM. */
  viaPantano: [12.90912, 43.89607] as [number, number],
  /** Via Lungo Genica — dal grafo OSM. */
  lungoGenica: [12.90852, 43.89185] as [number, number],
  /** Via Flaminia — dal grafo OSM. */
  viaFlaminia: [12.91741, 43.90465] as [number, number],
  /** Via Cesare Lombroso, zona sud-est — dal grafo OSM. */
  viaLombroso: [12.93265, 43.88713] as [number, number],
  /** Via Madonna di Loreto — dal grafo OSM. */
  madonnaDiLoreto: [12.91151, 43.89325] as [number, number],
  /** POI "srv-1", fontanella senza nome — da servizi.geojson. */
  fontanellaSenzaNome: [12.900227, 43.904348] as [number, number],
  /** POI "srv-25", parcheggio bici senza nome — da servizi.geojson. */
  parcheggioBici: [12.916659, 43.91502] as [number, number],
  /** POI "srv-0" "Giunti Professional Bike" — da servizi.geojson. */
  giuntiBike: [12.898185, 43.89957] as [number, number],
  /** POI "svg-8", parco — da svago.geojson. */
  parcoSvago: [12.898768, 43.896088] as [number, number],
  /** POI "svg-1", belvedere sul San Bartolo — da svago.geojson. */
  belvedereSanBartolo: [12.876876, 43.927509] as [number, number],
};

/**
 * Punti presi dai casi particolari presenti nei dati: servono ai test che
 * verificano avvisi e regole di percorrenza, non la geografia in generale.
 * Ogni coordinata e' quella di un nodo del grafo toccato dall'arco descritto.
 */
export const PLACES_CASI_LIMITE = {
  /** Arco della linea 5 con obbligo di scendere (ostacolo `obs-18`). */
  obbligoScendereLinea5: [12.90855, 43.8928] as [number, number],
  /** Arco della linea 9 con obbligo di scendere (ostacolo `obs-24`). */
  obbligoScendereLinea9: [12.88605, 43.89629] as [number, number],
  /** Via Bernardino Baldi, obbligo di scendere (ostacolo `obs-26`). */
  obbligoScendereViaBaldi: [12.89948, 43.91897] as [number, number],
  /** Archi con transito vietato alle bici (ostacolo `obs-11`, chicane). */
  transitoVietato: [12.9009, 43.91983] as [number, number],
  /** Strada di Montefeltro: tratto a senso unico nel grafo. */
  sensoUnico: [12.85952, 43.90557] as [number, number],
  /**
   * Meta' di Via Cerreto, l'arco piu' lungo del grafo (2,7 km senza incroci):
   * chi si trova qui e' su una strada nota, ma il nodo piu' vicino dista quasi
   * un chilometro in linea d'aria. E' il caso che mostra se il tratto a piedi
   * segue la strada o taglia per i campi.
   */
  mezzeriaViaCerreto: [12.90974, 43.84895] as [number, number],
};

/**
 * Id di POI realmente presenti nei GeoJSON esportati, uno per categoria
 * interessante. Se una rigenerazione dei dati li fa sparire, i test che li
 * citano devono fallire in modo esplicito invece di verificare il nulla.
 */
export const POI_REALI = {
  officinaVelomarche: 'srv-24',
  noleggioSanDecenzio: 'srv-4',
  negozioGiunti: 'srv-0',
  fontanella: 'srv-1',
  parcheggioBici: 'srv-25',
  barrieraCiclabile: 'obs-0',
  chicane: 'obs-11',
  barrieraDoppia: 'obs-17',
  parco: 'svg-8',
  belvedere: 'svg-1',
  areaPicnic: 'svg-0',
} as const;

/** Cerca una feature per id in una collezione GeoJSON esportata. */
export const featureById = (
  collection: GeoJsonCollection,
  id: string,
): GeoJsonCollection['features'][number] | undefined =>
  collection.features.find((f) => f.properties.id === id || f.id === id);

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
  /**
   * Borgo Santa Maria, frazione a ovest di Pesaro: circa 2,4 km dalla rete
   * coperta dai dati. Con Case Bruciate forma una coppia di punti entrambi
   * fuori rete, distanti poco piu' di un chilometro fra loro.
   */
  borgoSantaMaria: [12.8147, 43.8843] as [number, number],
  /**
   * Case Bruciate, verso Sminatori: circa 660 m dalla rete, cioe' dentro il
   * raggio di aggancio ma lontano dalla soglia dei punti di `PLACES`. E' la
   * destinazione del percorso che proponeva un giro da un'ora e venti.
   */
  caseBruciateNord: [12.833, 43.894] as [number, number],
};
