/**
 * Test della rifinitura dei tratti a piedi.
 *
 * Il servizio pedonale non viene mai contattato davvero: `fetch` e' sostituito
 * da una risposta fissa, cosi' il test verifica come il percorso viene
 * ricucito e non la disponibilita' di un server esterno.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { walkOnlyRoute } from '../../src/services/routing/router';
import { refineWalkingLegs, walkingPath } from '../../src/services/routing/walk';
import type { Route, RouteSegment } from '../../src/types';
import { lineLength } from '../../src/utils/geo';

/** Polilinea codificata in polyline6, come la restituisce Valhalla. */
const encodePolyline6 = (coords: [number, number][]): string => {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  const write = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e6);
    const ln = Math.round(lng * 1e6);
    write(la - lastLat);
    write(ln - lastLng);
    lastLat = la;
    lastLng = ln;
  }
  return out;
};

const rispostaPedonale = (coords: [number, number][]) => ({
  ok: true,
  json: async () => ({ trip: { legs: [{ shape: encodePolyline6(coords) }] } }),
});

const segmento = (over: Partial<RouteSegment>): RouteSegment => ({
  lineId: null,
  lineName: null,
  color: '#64748b',
  kind: 'piedi',
  distanceMeters: 0,
  durationSeconds: 0,
  coordinates: [],
  streetNames: [],
  ...over,
});

/** Percorso minimo: collegamento a piedi, tratto in bici, arrivo. */
function percorsoDiProva(): Route {
  const piedi = segmento({
    coordinates: [
      [12.9000, 43.9000],
      [12.9020, 43.9000],
    ],
  });
  piedi.distanceMeters = lineLength(piedi.coordinates);
  piedi.durationSeconds = 120;

  const bici = segmento({
    kind: 'bicipolitana',
    lineId: '1',
    coordinates: [
      [12.9020, 43.9000],
      [12.9100, 43.9000],
    ],
  });
  bici.distanceMeters = lineLength(bici.coordinates);
  bici.durationSeconds = 200;

  return {
    id: 'prova',
    profile: 'bicipolitana',
    profileLabel: 'Bicipolitana',
    profileIcon: '🚲',
    distanceMeters: Math.round(piedi.distanceMeters + bici.distanceMeters),
    durationSeconds: 320,
    durationMinutes: 6,
    geometry: [...piedi.coordinates, bici.coordinates[1]],
    segments: [piedi, bici],
    instructions: [
      {
        index: 0,
        type: 'walk-start',
        text: 'Raggiungi a piedi l’inizio del percorso ciclabile',
        distanceMeters: piedi.distanceMeters,
        durationSeconds: 120,
        location: piedi.coordinates[0],
        lineId: null,
        color: '#64748b',
        streetName: null,
        offsetMeters: 0,
      },
      {
        index: 1,
        type: 'arrive',
        text: 'Sei arrivato',
        distanceMeters: 0,
        durationSeconds: 0,
        location: bici.coordinates[1],
        lineId: null,
        color: null,
        streetName: null,
        offsetMeters: piedi.distanceMeters + bici.distanceMeters,
      },
    ],
    linesUsed: ['1'],
    bicipolitanaPercentage: 50,
    bicipolitanaMeters: Math.round(bici.distanceMeters),
    walkingMeters: Math.round(piedi.distanceMeters),
    warnings: [],
    obstacleIds: [],
    lighting: [],
    surfaces: [],
    durationIsEstimate: true,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('percorso a piedi su strada', () => {
  it('decodifica la geometria restituita dal servizio', async () => {
    const attesa: [number, number][] = [
      [12.9000, 43.9000],
      [12.9010, 43.9005],
      [12.9020, 43.9000],
    ];
    vi.stubGlobal('fetch', vi.fn(async () => rispostaPedonale(attesa)));

    const path = await walkingPath([12.9, 43.9], [12.902, 43.9]);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(3);
    for (const [i, [lng, lat]] of (path ?? []).entries()) {
      expect(lng).toBeCloseTo(attesa[i][0], 5);
      expect(lat).toBeCloseTo(attesa[i][1], 5);
    }
  });

  it('non contatta il servizio per collegamenti trascurabili', async () => {
    const chiamata = vi.fn();
    vi.stubGlobal('fetch', chiamata);
    expect(await walkingPath([12.9, 43.9], [12.90005, 43.9])).toBeNull();
    expect(chiamata).not.toHaveBeenCalled();
  });

  it('sostituisce il tratto in linea d’aria e riallinea le progressive', async () => {
    // Deviazione a nord: il tratto su strada e' piu' lungo della linea d'aria.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        rispostaPedonale([
          [12.9000, 43.9000],
          [12.9010, 43.9008],
          [12.9020, 43.9000],
        ]),
      ),
    );

    const prima = percorsoDiProva();
    const dopo = await refineWalkingLegs(prima);

    expect(dopo.walkingRouted).toBe(true);
    expect(dopo.segments[0].routed).toBe(true);
    expect(dopo.segments[0].coordinates.length).toBeGreaterThan(2);
    expect(dopo.walkingMeters).toBeGreaterThan(prima.walkingMeters);
    expect(dopo.distanceMeters).toBeGreaterThan(prima.distanceMeters);

    // La geometria mostrata e la lunghezza dichiarata devono restare coerenti.
    expect(lineLength(dopo.geometry)).toBeCloseTo(dopo.distanceMeters, 0);

    // L'arrivo resta in fondo al percorso, non a meta'.
    const arrivo = dopo.instructions.find((i) => i.type === 'arrive');
    expect(arrivo?.offsetMeters).toBeCloseTo(dopo.distanceMeters, 0);
  });

  it('rifiuta un giro sproporzionato: fra i due punti c’è una barriera', async () => {
    /*
     * Il servizio risponde con il giro reale — corretto, ma di chilometri
     * perche' in mezzo c'e' un'autostrada. Accettarlo farebbe sembrare il
     * percorso una camminata interminabile: si tiene la linea d'aria, che
     * l'interfaccia dichiara come tale.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        rispostaPedonale([
          [12.9000, 43.9000],
          [12.9010, 43.9200],
          [12.9020, 43.9000],
        ]),
      ),
    );

    const prima = percorsoDiProva();
    const dopo = await refineWalkingLegs(prima);

    expect(dopo.segments[0].routed).toBeUndefined();
    expect(dopo.walkingMeters).toBe(prima.walkingMeters);
    expect(dopo.distanceMeters).toBe(prima.distanceMeters);
  });

  it('rifinisce anche un percorso interamente a piedi', async () => {
    /*
     * Il percorso a piedi non ha una parte pedalata in mezzo: il suo unico
     * tratto e' insieme il primo e l'ultimo, e l'istruzione che lo descrive
     * deve seguire la nuova lunghezza senza cambiare testo — non si raggiunge
     * nessun inizio di ciclabile, si cammina fino a destinazione.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        rispostaPedonale([
          [12.9000, 43.9000],
          [12.9010, 43.9008],
          [12.9020, 43.9000],
        ]),
      ),
    );

    const prima = walkOnlyRoute([12.9, 43.9], [12.902, 43.9], 'Case Bruciate') as Route;
    const dopo = await refineWalkingLegs(prima);

    expect(dopo.segments).toHaveLength(1);
    expect(dopo.segments[0].routed).toBe(true);
    expect(dopo.walkingMeters).toBeGreaterThan(prima.walkingMeters);
    expect(dopo.distanceMeters).toBe(dopo.walkingMeters);
    expect(lineLength(dopo.geometry)).toBeCloseTo(dopo.distanceMeters, 0);

    const partenza = dopo.instructions[0];
    expect(partenza.text).toBe(prima.instructions[0].text);
    expect(partenza.distanceMeters).toBeCloseTo(dopo.distanceMeters, 0);

    const arrivo = dopo.instructions[dopo.instructions.length - 1];
    expect(arrivo.type).toBe('arrive');
    expect(arrivo.offsetMeters).toBeCloseTo(dopo.distanceMeters, 0);
  });

  it('al percorso a piedi concede il giro che a un raccordo negherebbe', async () => {
    /*
     * Stesso tracciato, quasi tre volte la linea d'aria. Per un raccordo e' il
     * segno che in mezzo c'e' una barriera, e si tiene la linea d'aria: quel
     * tratto e' un pezzo di un percorso che comunque esiste. Per il percorso
     * interamente a piedi no — la linea d'aria sarebbe tutto il percorso, e
     * mostrarla dritta attraverso i campi significa mostrare una cosa che non
     * si puo' fare.
     */
    const giro: [number, number][] = [
      [12.9000, 43.9000],
      [12.9010, 43.9020],
      [12.9020, 43.9000],
    ];
    vi.stubGlobal('fetch', vi.fn(async () => rispostaPedonale(giro)));

    const cammino = await refineWalkingLegs(
      walkOnlyRoute([12.9, 43.9], [12.902, 43.9], null) as Route,
    );
    expect(cammino.segments[0].routed).toBe(true);
    expect(cammino.distanceMeters).toBeGreaterThan(2.5 * lineLength([giro[0], giro[2]]));

    // Lo stesso giro, chiesto come raccordo, resta respinto.
    const raccordo = await refineWalkingLegs(percorsoDiProva());
    expect(raccordo.segments[0].routed).toBeUndefined();
  });

  it('lascia il percorso invariato se il servizio non risponde', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    const prima = percorsoDiProva();
    const dopo = await refineWalkingLegs(prima);

    expect(dopo).toEqual(prima);
    expect(dopo.walkingRouted).toBeUndefined();
  });
});
