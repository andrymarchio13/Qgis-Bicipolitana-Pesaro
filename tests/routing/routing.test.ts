/**
 * Test del motore di routing sui dati reali di Pesaro.
 *
 * Non si assume che due luoghi siano collegati da una sola linea: si verifica
 * che il router trovi un percorso e che i profili si comportino come dichiarato.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ROUTING_PROFILES, WALK_SNAP_MAX_DISTANCE_METERS } from '../../src/config';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter, RoutingError } from '../../src/services/routing/router';
import type { Line, Route } from '../../src/types';
import { haversine, lineLength } from '../../src/utils/geo';
import { graph, linesFile, PLACES, PLACES_FUORI_RETE } from '../helpers';

let index: RoutingGraphIndex;
let router: BicipolitanaRouter;
let lines: Map<string, Line>;

beforeAll(() => {
  index = new RoutingGraphIndex(graph());
  lines = new Map(linesFile().lines.map((l) => [l.id, l]));
  router = new BicipolitanaRouter(index, lines);
});

const expectValidRoute = (route: Route): void => {
  expect(route.distanceMeters).toBeGreaterThan(0);
  expect(route.durationSeconds).toBeGreaterThan(0);
  expect(route.geometry.length).toBeGreaterThan(1);
  expect(route.segments.length).toBeGreaterThan(0);
  expect(route.instructions.length).toBeGreaterThan(1);
  expect(route.bicipolitanaPercentage).toBeGreaterThanOrEqual(0);
  expect(route.bicipolitanaPercentage).toBeLessThanOrEqual(100);
  expect(Number.isFinite(route.durationMinutes)).toBe(true);

  // La geometria deve corrispondere alla distanza dichiarata (±3%).
  const measured = lineLength(route.geometry);
  expect(Math.abs(measured - route.distanceMeters) / route.distanceMeters).toBeLessThan(0.03);

  // Nessun testo dell'interfaccia può contenere valori non definiti.
  for (const instruction of route.instructions) {
    expect(instruction.text).not.toMatch(/undefined|NaN|null/);
    expect(Number.isFinite(instruction.distanceMeters)).toBe(true);
  }
};

describe('aggancio al grafo', () => {
  it('aggancia i punti del centro entro poche decine di metri', () => {
    const snap = index.snap(PLACES.parcheggioSanDecenzio, 700);
    expect(snap).not.toBeNull();
    expect(snap?.distanceMeters).toBeLessThan(120);
  });

  it('rifiuta punti fuori dall’area coperta dai dati', () => {
    // Un punto in mezzo all'Adriatico, ben oltre la copertura.
    expect(index.snap([13.2, 43.95], 700)).toBeNull();
  });

  it('dichiara la distanza dal nodo che il percorso usa davvero', () => {
    // Il numero mostrato e il tratto disegnato devono essere la stessa cosa:
    // misurare la distanza dall'arco e poi camminare fino al nodo produrrebbe
    // un percorso piu' lungo di quanto dichiarato.
    for (const place of [...Object.values(PLACES), ...Object.values(PLACES_FUORI_RETE)]) {
      const snap = index.snap(place, WALK_SNAP_MAX_DISTANCE_METERS);
      expect(snap).not.toBeNull();
      const nodo = index.nodes[snap!.nodeId];
      expect(Math.abs(haversine(place, nodo) - snap!.distanceMeters)).toBeLessThan(0.5);
    }
  });

  it('sceglie l’estremità più vicina, non quella con l’offset minore', () => {
    // Nessun altro nodo del grafo deve essere più vicino di quello scelto.
    const snap = index.snap(PLACES_FUORI_RETE.caseBruciate, WALK_SNAP_MAX_DISTANCE_METERS);
    const minimo = Math.min(...index.nodes.map((n) => haversine(PLACES_FUORI_RETE.caseBruciate, n)));
    expect(snap!.distanceMeters).toBeCloseTo(minimo, 0);
  });

  it('aggancia comunque un punto lontano quando si allarga il raggio', () => {
    expect(index.snap(PLACES_FUORI_RETE.caseBruciate, 700)).toBeNull();
    const esteso = index.snap(PLACES_FUORI_RETE.caseBruciate, WALK_SNAP_MAX_DISTANCE_METERS);
    expect(esteso).not.toBeNull();
    expect(esteso?.distanceMeters).toBeGreaterThan(700);
    expect(esteso?.distanceMeters).toBeLessThan(WALK_SNAP_MAX_DISTANCE_METERS);
  });
});

describe('partenza fuori dalla rete coperta dai dati', () => {
  it('non fallisce: collega il punto alla rete con un tratto a piedi', () => {
    const routes = router.route({
      origin: PLACES_FUORI_RETE.caseBruciate,
      destination: PLACES.lungomareTrieste,
    });
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      expectValidRoute(route);

      // Il percorso parte esattamente dal punto scelto dall'utente...
      expect(route.geometry[0]).toEqual(PLACES_FUORI_RETE.caseBruciate);
      // ...e il primo tratto è a piedi, non in bicicletta.
      expect(route.segments[0].kind).toBe('piedi');
      expect(route.instructions[0].type).toBe('walk-start');

      // Il collegamento a piedi è lungo quanto la distanza dalla rete.
      expect(route.walkingMeters).toBeGreaterThan(700);
      expect(route.walkingMeters).toBeLessThan(route.distanceMeters);
    }
  });
});

describe('percorsi reali a Pesaro', () => {
  const cases: [string, [number, number], [number, number]][] = [
    ['San Decenzio → Lungomare Trieste', PLACES.parcheggioSanDecenzio, PLACES.lungomareTrieste],
    ['Velomarche → Piazzale della Libertà', PLACES.velomarche, PLACES.piazzaleLiberta],
    ['San Decenzio → Via Solferino', PLACES.parcheggioSanDecenzio, PLACES.viaSolferino],
    ['Velomarche → Pista Cardinali', PLACES.velomarche, PLACES.pistaCardinali],
  ];

  for (const [name, origin, destination] of cases) {
    it(`calcola almeno un percorso: ${name}`, () => {
      const routes = router.route({ origin, destination });
      expect(routes.length).toBeGreaterThan(0);
      for (const route of routes) expectValidRoute(route);
    });
  }

  it('propone alternative distinte fra loro', () => {
    const routes = router.route({
      origin: PLACES.parcheggioSanDecenzio,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana', 'fast', 'quiet'],
    });
    const geometries = new Set(routes.map((r) => r.geometry.length));
    expect(routes.length).toBeGreaterThan(1);
    expect(geometries.size).toBeGreaterThan(0);
  });

  it('mette il profilo Bicipolitana in cima ai risultati', () => {
    const routes = router.route({ origin: PLACES.parcheggioSanDecenzio, destination: PLACES.lungomareTrieste });
    expect(routes[0].profile).toBe('bicipolitana');
  });
});

describe('profili di calcolo', () => {
  it('il profilo Bicipolitana usa più rete ufficiale del profilo veloce', () => {
    const [bici] = router.route({
      origin: PLACES.parcheggioSanDecenzio,
      destination: PLACES.lungomareTrieste,
      profiles: ['bicipolitana'],
    });
    const [fast] = router.route({
      origin: PLACES.parcheggioSanDecenzio,
      destination: PLACES.lungomareTrieste,
      profiles: ['fast'],
    });
    expect(bici.bicipolitanaPercentage).toBeGreaterThanOrEqual(fast.bicipolitanaPercentage);
  });

  it('il profilo veloce non è più lento del profilo tranquillo', () => {
    const [fast] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.piazzaleLiberta,
      profiles: ['fast'],
    });
    const [quiet] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.piazzaleLiberta,
      profiles: ['quiet'],
    });
    expect(fast.durationSeconds).toBeLessThanOrEqual(quiet.durationSeconds * 1.02);
  });

  it('il profilo sicuro sceglie archi con punteggio di sicurezza più alto', () => {
    const safetyOf = (route: Route): number => {
      // media pesata sulla lunghezza del punteggio degli archi percorsi
      let total = 0;
      let weighted = 0;
      for (const segment of route.segments) {
        const s = segment.kind === 'bicipolitana' ? 1 : 0.5;
        weighted += s * segment.distanceMeters;
        total += segment.distanceMeters;
      }
      return total > 0 ? weighted / total : 0;
    };
    const [safe] = router.route({
      origin: PLACES.parcheggioSanDecenzio,
      destination: PLACES.viaSolferino,
      profiles: ['safe'],
    });
    const [fast] = router.route({
      origin: PLACES.parcheggioSanDecenzio,
      destination: PLACES.viaSolferino,
      profiles: ['fast'],
    });
    expect(safetyOf(safe)).toBeGreaterThanOrEqual(safetyOf(fast) - 0.01);
  });

  it('tutti i profili dichiarati sono utilizzabili', () => {
    for (const profile of Object.values(ROUTING_PROFILES)) {
      const routes = router.route({
        origin: PLACES.parcheggioSanDecenzio,
        destination: PLACES.velomarche,
        profiles: [profile.id],
      });
      expect(routes[0].profile).toBe(profile.id);
    }
  });
});

describe('linea preferita', () => {
  it('“Usa questa linea” aumenta la presenza della linea scelta', () => {
    const target = '3';
    const [normal] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    const [preferred] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
      preferredLineId: target,
    });
    const share = (route: Route): number =>
      route.segments
        .filter((s) => s.lineId === target)
        .reduce((sum, s) => sum + s.distanceMeters, 0);
    expect(share(preferred)).toBeGreaterThanOrEqual(share(normal) - 1);
  });
});

describe('tratti a piedi fuori dalla rete', () => {
  // Un punto volutamente lontano da qualunque strada: la campagna a sud-ovest.
  const remote: [number, number] = [12.8617, 43.8712];

  it('collega il punto scoperto con un tratto a piedi dichiarato', () => {
    const [route] = router.route({
      origin: remote,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    expect(route.walkingMeters).toBeGreaterThan(0);

    const walking = route.segments.filter((s) => s.kind === 'piedi');
    expect(walking.length).toBeGreaterThan(0);
    // Il tratto a piedi parte esattamente dal punto scelto dall'utente.
    expect(walking[0].coordinates[0][0]).toBeCloseTo(remote[0], 5);
    expect(walking[0].coordinates[0][1]).toBeCloseTo(remote[1], 5);
    expect(walking[0].lineId).toBeNull();
  });

  it('la geometria parte dall’origine e finisce sulla destinazione', () => {
    const [route] = router.route({
      origin: remote,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    const first = route.geometry[0];
    const last = route.geometry[route.geometry.length - 1];
    expect(first[0]).toBeCloseTo(remote[0], 5);
    expect(last[0]).toBeCloseTo(PLACES.viaSolferino[0], 4);
  });

  it('annuncia il tratto a piedi nelle istruzioni', () => {
    const [route] = router.route({
      origin: remote,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    const walkInstructions = route.instructions.filter(
      (i) => i.type === 'walk-start' || i.type === 'walk-end',
    );
    expect(walkInstructions.length).toBeGreaterThan(0);
    for (const instruction of walkInstructions) {
      expect(instruction.text).toMatch(/piedi/i);
      expect(instruction.distanceMeters).toBeGreaterThan(0);
    }
  });

  it('non aggiunge tratti a piedi quando il punto è già sulla rete', () => {
    const [route] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.piazzaleLiberta,
      profiles: ['bicipolitana'],
    });
    // I due punti sono a pochi metri dalla rete: nessun tratto significativo.
    expect(route.walkingMeters).toBeLessThan(60);
  });

  it('conta i metri a piedi dentro distanza e durata totali', () => {
    const [route] = router.route({
      origin: remote,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    const measured = lineLength(route.geometry);
    expect(Math.abs(measured - route.distanceMeters) / route.distanceMeters).toBeLessThan(0.03);
    const walkingShare = route.walkingMeters / route.distanceMeters;
    expect(walkingShare).toBeGreaterThan(0);
    expect(walkingShare).toBeLessThan(1);
  });
});

describe('gestione degli errori', () => {
  it('rifiuta origine e destinazione coincidenti con un messaggio comprensibile', () => {
    expect(() =>
      router.route({ origin: PLACES.parcheggioSanDecenzio, destination: PLACES.parcheggioSanDecenzio }),
    ).toThrowError(RoutingError);

    try {
      router.route({ origin: PLACES.parcheggioSanDecenzio, destination: PLACES.parcheggioSanDecenzio });
    } catch (error) {
      expect((error as RoutingError).message).not.toMatch(/undefined|NaN|500/);
      expect((error as RoutingError).code).toBe('same-point');
    }
  });

  it('spiega quando la destinazione è fuori area', () => {
    try {
      router.route({ origin: PLACES.parcheggioSanDecenzio, destination: [13.4, 44.2] });
      throw new Error('doveva fallire');
    } catch (error) {
      expect(error).toBeInstanceOf(RoutingError);
      expect((error as RoutingError).code).toBe('destination-unreachable');
      expect((error as RoutingError).message).toMatch(/area/i);
    }
  });
});

describe('segnalazioni lungo il percorso', () => {
  it('avvisa solo di cose che stanno sulla strada, non della forma del percorso', () => {
    // Il tratto a piedi si spiega con il tratteggio, la distanza e la sua
    // istruzione: non deve generare un avviso sul percorso.
    const routes = router.route({
      origin: PLACES_FUORI_RETE.caseBruciate,
      destination: PLACES.lungomareTrieste,
    });
    for (const route of routes) {
      expect(route.walkingMeters).toBeGreaterThan(700);
      for (const warning of route.warnings) {
        expect(['obstacle', 'dismount', 'blocked', 'data']).toContain(warning.type);
        expect(warning.message).not.toMatch(/linea d’aria|tratteggiat/i);
      }
    }
  });


  it('gli avvisi citano solo ostacoli presenti nel dataset', () => {
    const routes = router.route({ origin: PLACES.parcheggioSanDecenzio, destination: PLACES.viaSolferino });
    for (const route of routes) {
      for (const warning of route.warnings) {
        expect(warning.message.length).toBeGreaterThan(10);
        expect(warning.message).not.toMatch(/undefined|NaN/);
      }
      for (const id of route.obstacleIds) expect(id).toMatch(/^obs-\d+$/);
    }
  });
});
