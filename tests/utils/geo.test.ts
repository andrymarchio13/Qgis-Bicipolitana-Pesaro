/** Test delle funzioni geometriche e della formattazione. */
import { describe, expect, it } from 'vitest';

import {
  angleDelta,
  bearing,
  boundsOf,
  formatDistance,
  formatDuration,
  haversine,
  lineLength,
  pointAtOffset,
  projectOnLine,
} from '../../src/utils/geo';
import type { LngLat } from '../../src/types';

const CENTRO: LngLat = [12.9128, 43.9099];

describe('haversine', () => {
  it('è zero fra un punto e se stesso', () => {
    expect(haversine(CENTRO, CENTRO)).toBe(0);
  });

  it('calcola una distanza nota con errore inferiore all’1%', () => {
    // Un grado di latitudine ≈ 111,2 km.
    const a: LngLat = [12.9, 43.9];
    const b: LngLat = [12.9, 44.9];
    expect(Math.abs(haversine(a, b) - 111_200) / 111_200).toBeLessThan(0.01);
  });

  it('è simmetrica', () => {
    const a: LngLat = [12.9, 43.9];
    const b: LngLat = [12.95, 43.92];
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 6);
  });
});

describe('lineLength', () => {
  it('somma le distanze dei singoli segmenti', () => {
    const coords: LngLat[] = [
      [12.9, 43.9],
      [12.91, 43.9],
      [12.92, 43.9],
    ];
    const total = lineLength(coords);
    expect(total).toBeCloseTo(haversine(coords[0], coords[1]) + haversine(coords[1], coords[2]), 6);
  });

  it('è zero per una polilinea con un solo punto', () => {
    expect(lineLength([CENTRO])).toBe(0);
  });
});

describe('bearing e angleDelta', () => {
  it('verso nord è circa 0°', () => {
    expect(bearing([12.9, 43.9], [12.9, 43.95])).toBeCloseTo(0, 1);
  });

  it('verso est è circa 90°', () => {
    expect(bearing([12.9, 43.9], [12.95, 43.9])).toBeCloseTo(90, 0);
  });

  it('normalizza la differenza angolare nell’intervallo -180..180', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20, 6);
    expect(angleDelta(10, 350)).toBeCloseTo(-20, 6);
    expect(angleDelta(0, 180)).toBeCloseTo(180, 6);
  });
});

describe('projectOnLine', () => {
  const line: LngLat[] = [
    [12.9, 43.9],
    [12.92, 43.9],
  ];

  it('proietta un punto laterale sul segmento', () => {
    const result = projectOnLine([12.91, 43.905], line);
    expect(result.point[1]).toBeCloseTo(43.9, 4);
    expect(result.distanceMeters).toBeGreaterThan(400);
    expect(result.offsetMeters).toBeGreaterThan(0);
  });

  it('restituisce distanza nulla per un punto già sulla linea', () => {
    const result = projectOnLine([12.91, 43.9], line);
    expect(result.distanceMeters).toBeLessThan(1);
  });

  it('non supera la lunghezza della linea', () => {
    const result = projectOnLine([13.0, 43.9], line);
    expect(result.offsetMeters).toBeLessThanOrEqual(lineLength(line) + 1);
  });
});

describe('pointAtOffset', () => {
  const line: LngLat[] = [
    [12.9, 43.9],
    [12.92, 43.9],
  ];

  it('restituisce il primo punto per offset zero o negativo', () => {
    expect(pointAtOffset(line, 0)).toEqual(line[0]);
    expect(pointAtOffset(line, -50)).toEqual(line[0]);
  });

  it('restituisce l’ultimo punto oltre la lunghezza', () => {
    expect(pointAtOffset(line, 999_999)).toEqual(line[1]);
  });

  it('a metà lunghezza restituisce un punto intermedio', () => {
    const half = lineLength(line) / 2;
    const point = pointAtOffset(line, half);
    expect(point[0]).toBeGreaterThan(line[0][0]);
    expect(point[0]).toBeLessThan(line[1][0]);
  });
});

describe('boundsOf', () => {
  it('è null per una lista vuota', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('racchiude tutti i punti', () => {
    const bounds = boundsOf([
      [12.9, 43.9],
      [12.95, 43.92],
      [12.88, 43.88],
    ]);
    expect(bounds).toEqual([
      [12.88, 43.88],
      [12.95, 43.92],
    ]);
  });
});

describe('formattazione per l’interfaccia', () => {
  it('non mostra mai NaN o undefined', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('usa metri sotto il chilometro e chilometri sopra', () => {
    expect(formatDistance(340)).toBe('340 m');
    expect(formatDistance(2150)).toBe('2.1 km');
  });

  it('formatta le durate in modo leggibile', () => {
    expect(formatDuration(30)).toBe('< 1 min');
    expect(formatDuration(510)).toBe('9 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3900)).toBe('1 h 5 min');
  });
});
