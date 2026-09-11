/**
 * Test della proposta a piedi.
 *
 * Fra due punti che stanno entrambi fuori dalla rete coperta dai dati il
 * calcolo aggancia comunque la Bicipolitana, e il giro che ne esce puo' valere
 * il triplo della distanza reale. Qui si verifica che accanto a quella
 * proposta ne compaia una a piedi con i metri che separano davvero i due
 * punti, e che dove la rete serve i due punti quella proposta non compaia.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { WALK_ONLY_MAX_METERS, WALK_ONLY_MIN_DETOUR } from '../../src/config';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter, walkOnlyRoute } from '../../src/services/routing/router';
import { connectorSummary, routeRationale } from '../../src/services/routing/instructions';
import type { Line, Route } from '../../src/types';
import { haversine, lineLength } from '../../src/utils/geo';
import { graph, linesFile, PLACES, PLACES_FUORI_RETE } from '../helpers';

let router: BicipolitanaRouter;

beforeAll(() => {
  const index = new RoutingGraphIndex(graph());
  const lines = new Map(linesFile().lines.map((l) => [l.id, l] as [string, Line]));
  router = new BicipolitanaRouter(index, lines);
});

const aPiedi = (routes: Route[]): Route | undefined => routes.find((r) => r.onFoot);

describe('proposta a piedi fra punti fuori rete', () => {
  const origine = PLACES_FUORI_RETE.borgoSantaMaria;
  const destinazione = PLACES_FUORI_RETE.caseBruciate;

  it('propone di andare a piedi quando la rete obbliga a un lungo giro', () => {
    const routes = router.route({ origin: origine, destination: destinazione });
    const piedi = aPiedi(routes);
    expect(piedi).toBeDefined();

    const diretta = haversine(origine, destinazione);
    // La proposta ciclabile esiste ancora: la scelta resta a chi parte.
    const inBici = routes.filter((r) => !r.onFoot);
    expect(inBici.length).toBeGreaterThan(0);
    expect(Math.min(...inBici.map((r) => r.distanceMeters))).toBeGreaterThan(
      diretta * WALK_ONLY_MIN_DETOUR,
    );

    // E' il percorso diretto: niente giro, niente rete.
    expect(piedi?.distanceMeters).toBeCloseTo(diretta, 0);
    expect(piedi?.bicipolitanaMeters).toBe(0);
    expect(piedi?.linesUsed).toHaveLength(0);
    expect(piedi?.segments.every((s) => s.kind === 'piedi')).toBe(true);
    expect(piedi?.segments.every((s) => s.transport === 'piedi')).toBe(true);
  });

  it('mette la proposta a piedi davanti al giro piu\u2019 lungo', () => {
    const routes = router.route({ origin: origine, destination: destinazione });
    expect(routes[0].onFoot).toBe(true);
  });

  it('dichiara i propri numeri in modo coerente', () => {
    const routes = router.route({ origin: origine, destination: destinazione });
    const piedi = aPiedi(routes) as Route;

    expect(lineLength(piedi.geometry)).toBeCloseTo(piedi.distanceMeters, 0);
    expect(piedi.walkingMeters).toBe(piedi.distanceMeters);
    expect(piedi.bicipolitanaPercentage).toBe(0);
    expect(piedi.instructions.length).toBeGreaterThan(1);
    expect(piedi.instructions[piedi.instructions.length - 1].type).toBe('arrive');
    for (const instruction of piedi.instructions) {
      expect(instruction.text).not.toMatch(/undefined|NaN|null/);
    }
    // I dati non dicono nulla su fondo e illuminazione di un tratto che non e'
    // un arco del grafo: il percorso non deve inventarselo.
    expect(piedi.lighting.every((span) => span.lit === null)).toBe(true);
    expect(piedi.warnings).toHaveLength(0);
  });

  it('si presenta come cammino, non come raccordo', () => {
    const routes = router.route({ origin: origine, destination: destinazione });
    const piedi = aPiedi(routes) as Route;
    expect(connectorSummary(piedi)?.label).toContain('a piedi');
    expect(routeRationale(piedi)).toContain('piedi');
  });
});

describe('quando la proposta a piedi non serve', () => {
  it('non compare fra due punti serviti dalla rete', () => {
    const routes = router.route({
      origin: PLACES.piazzaleLiberta,
      destination: PLACES.lungomareTrieste,
    });
    expect(aPiedi(routes)).toBeUndefined();
  });

  it('non compare quando i due punti sono troppo lontani per camminare', () => {
    const lontano: [number, number] = [
      PLACES_FUORI_RETE.borgoSantaMaria[0],
      PLACES_FUORI_RETE.borgoSantaMaria[1],
    ];
    // Un punto oltre il limite dichiarato: a quella distanza camminare non e'
    // un'alternativa che qualcuno sceglierebbe.
    const routes = router.route({ origin: lontano, destination: PLACES.panoramicaArdizio });
    expect(haversine(lontano, PLACES.panoramicaArdizio)).toBeGreaterThan(WALK_ONLY_MAX_METERS);
    expect(aPiedi(routes)).toBeUndefined();
  });

  it('non sostituisce il percorso durante il ricalcolo in navigazione', () => {
    const ricalcolo = router.reroute(
      PLACES_FUORI_RETE.borgoSantaMaria,
      PLACES_FUORI_RETE.caseBruciate,
      'bicipolitana',
      null,
    );
    expect(ricalcolo?.onFoot).toBeUndefined();
  });

  it('chi sta camminando continua a camminare', () => {
    const ricalcolo = router.reroute(
      PLACES_FUORI_RETE.borgoSantaMaria,
      PLACES_FUORI_RETE.caseBruciate,
      'piedi',
      'Case Bruciate',
    );
    expect(ricalcolo?.onFoot).toBe(true);
    expect(ricalcolo?.instructions[0].text).toContain('Case Bruciate');
  });

  it('non propone un percorso per due punti che coincidono', () => {
    expect(walkOnlyRoute([12.9, 43.9], [12.9, 43.9], null)).toBeNull();
  });
});
