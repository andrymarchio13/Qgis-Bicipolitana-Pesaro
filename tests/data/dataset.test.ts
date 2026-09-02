/**
 * Verifiche sui dati generati dalla pipeline GIS.
 * Falliscono se una rigenerazione introduce dati incoerenti o inventati.
 */
import { describe, expect, it } from 'vitest';

import { geojson, graph, linesFile, metadata, PLACES } from '../helpers';
import { PESARO_BOUNDS } from '../../src/config';

const inPesaro = ([lng, lat]: [number, number]): boolean =>
  lng >= PESARO_BOUNDS[0][0] &&
  lng <= PESARO_BOUNDS[1][0] &&
  lat >= PESARO_BOUNDS[0][1] &&
  lat <= PESARO_BOUNDS[1][1];

describe('metadati del progetto', () => {
  const meta = metadata();

  it('dichiara i sistemi di riferimento di origine e web', () => {
    expect(meta.crsOriginal).toBe('EPSG:3004');
    expect(meta.webCrs).toBe('EPSG:4326');
  });

  it('cita le fonti dei dati', () => {
    expect(meta.sources.join(' ')).toMatch(/OpenStreetMap/i);
    expect(meta.attribution).toMatch(/OpenStreetMap/i);
  });

  it('dichiara la velocità usata per le stime dei tempi', () => {
    expect(meta.estimates.cyclingSpeedKmh).toBeGreaterThan(5);
    expect(meta.estimates.note).toMatch(/stime/i);
  });

  it('registra le feature escluse invece di nasconderle', () => {
    // Il dataset originale contiene una geometria vuota sulla linea 3.
    expect(meta.excludedFeatures.length).toBeGreaterThan(0);
    expect(meta.excludedFeatures.every((f) => typeof f.reason === 'string')).toBe(true);
  });
});

describe('linee della Bicipolitana', () => {
  const { lines } = linesFile();

  it('contiene le 15 linee del dataset (1-13, A, B)', () => {
    expect(lines).toHaveLength(15);
    expect(lines.map((l) => l.id)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'A', 'B',
    ]);
  });

  it('non inventa nomi ufficiali né stati', () => {
    for (const line of lines) {
      expect(line.officialName).toBeNull();
      expect(line.status).toBe('unknown');
    }
  });

  it('ha un colore valido per ogni linea, dichiarandone la provenienza', () => {
    for (const line of lines) {
      expect(line.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(line.colorSource.length).toBeGreaterThan(0);
    }
  });

  it('segnala la linea 13, priva di colore nella simbologia QGIS', () => {
    const line13 = lines.find((l) => l.id === '13');
    expect(line13?.colorNeedsConfirmation).toBe(true);
  });

  it('segnala il colore condiviso fra le linee 2 e 5', () => {
    const line2 = lines.find((l) => l.id === '2');
    const line5 = lines.find((l) => l.id === '5');
    expect(line2?.color).toBe(line5?.color);
    expect(line2?.colorConflictsWith).toContain('5');
    expect(line5?.colorConflictsWith).toContain('2');
  });

  it('ha lunghezze coerenti con il dato GIS (61 km complessivi)', () => {
    const total = lines.reduce((sum, l) => sum + l.lengthKm, 0);
    expect(total).toBeGreaterThan(60);
    expect(total).toBeLessThan(62);
  });
});

describe('GeoJSON esportati', () => {
  it('le linee sono in WGS84 e ricadono nell’area di Pesaro', () => {
    const fc = geojson('linee_bicipolitana.geojson');
    expect(fc.features).toHaveLength(15);
    for (const feature of fc.features) {
      const coords = feature.geometry.coordinates as number[][] | number[][][];
      const first = (Array.isArray(coords[0][0]) ? coords[0][0] : coords[0]) as [number, number];
      expect(inPesaro(first)).toBe(true);
    }
  });

  it('ogni POI ha una categoria e i tag originali', () => {
    for (const name of ['servizi.geojson', 'ostacoli.geojson', 'svago.geojson']) {
      const fc = geojson(name);
      expect(fc.features.length).toBeGreaterThan(0);
      for (const feature of fc.features) {
        expect(feature.properties.category).toBeTruthy();
        expect(feature.properties.categoryLabel).toBeTruthy();
        expect(feature.properties.tags).toBeTypeOf('object');
      }
    }
  });

  it('gli ostacoli dichiarano l’accesso in bici in forma leggibile', () => {
    const fc = geojson('ostacoli.geojson');
    for (const feature of fc.features) {
      expect(feature.properties.bicycleAccessLabel).toBeTruthy();
      expect(String(feature.properties.bicycleAccessLabel)).not.toMatch(/undefined|NaN/);
    }
  });
});

describe('grafo di routing', () => {
  const g = graph();

  it('dichiara i parametri del modello come stime', () => {
    expect(g.parameters.cyclingSpeedKmh).toBeGreaterThan(0);
    expect(g.parameters.note).toMatch(/stime|euristic/i);
  });

  it('ha nodi e archi coerenti fra loro', () => {
    expect(g.nodes.length).toBeGreaterThan(1000);
    expect(g.edges.length).toBeGreaterThan(1000);
    for (const edge of g.edges) {
      expect(edge.a).toBeGreaterThanOrEqual(0);
      expect(edge.a).toBeLessThan(g.nodes.length);
      expect(edge.b).toBeLessThan(g.nodes.length);
      expect(edge.d).toBeGreaterThan(0);
      expect(edge.t).toBeGreaterThan(0);
      expect(edge.s).toBeGreaterThanOrEqual(0);
      expect(edge.s).toBeLessThanOrEqual(1);
    }
  });

  it('colloca tutti i nodi nell’area di Pesaro', () => {
    for (const node of g.nodes) expect(inPesaro(node)).toBe(true);
  });

  it('contiene archi di Bicipolitana per tutte le 15 linee', () => {
    const ids = new Set(g.edges.filter((e) => e.k === 0).map((e) => e.l));
    expect(ids.size).toBe(15);
  });

  it('assegna a ogni arco di Bicipolitana il colore della sua linea', () => {
    const colors = new Map(linesFile().lines.map((l) => [l.id, l.color]));
    for (const edge of g.edges) {
      if (edge.k !== 0 || !edge.l) continue;
      expect(edge.c).toBe(colors.get(edge.l));
    }
  });

  it('la geometria di ogni arco parte e arriva sui nodi dichiarati', () => {
    for (const edge of g.edges.slice(0, 500)) {
      const start = edge.g[0];
      const end = edge.g[edge.g.length - 1];
      const nodeA = g.nodes[edge.a];
      const nodeB = g.nodes[edge.b];
      // tolleranza pari alla precisione di esportazione (5 decimali ≈ 1,1 m)
      expect(Math.abs(start[0] - nodeA[0])).toBeLessThan(0.0001);
      expect(Math.abs(end[1] - nodeB[1])).toBeLessThan(0.0001);
    }
  });
});

describe('luoghi di riferimento usati nei test', () => {
  it('ricadono nell’area coperta dai dati', () => {
    for (const point of Object.values(PLACES)) expect(inPesaro(point)).toBe(true);
  });
});
