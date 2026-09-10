/**
 * Test dell'illuminazione sui dati reali: dal tag OSM al percorso calcolato.
 *
 * Verificano due cose che i test in memoria non possono verificare: che il
 * grafo pubblicato porti davvero il dato, e che un percorso vero lo riporti
 * tratto per tratto senza perdere metri per strada.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter } from '../../src/services/routing/router';
import { darknessOnRoute } from '../../src/services/daylight';
import type { Line, Route } from '../../src/types';
import { graph, linesFile, PLACES } from '../helpers';

let router: BicipolitanaRouter;
let percorso: Route;

beforeAll(() => {
  const index = new RoutingGraphIndex(graph());
  const lines = new Map<string, Line>(linesFile().lines.map((l) => [l.id, l]));
  router = new BicipolitanaRouter(index, lines);
  percorso = router.route({
    origin: PLACES.piazzaleLiberta,
    destination: PLACES.velomarche,
    profiles: ['bicipolitana'],
  })[0]!;
});

describe('il dato di illuminazione nel grafo pubblicato', () => {
  it('è presente su una parte degli archi, con valori solo 0 o 1', () => {
    const edges = graph().edges;
    const dichiarati = edges.filter((e) => e.lt !== undefined);

    expect(dichiarati.length).toBeGreaterThan(0);
    for (const edge of dichiarati) {
      expect([0, 1]).toContain(edge.lt);
    }
  });

  it('lascia assente il dato dove OSM non lo dichiara, invece di scrivere 0', () => {
    // Se l'assenza fosse tradotta in "non illuminato", tutti gli archi
    // avrebbero il campo: e' proprio quello che non deve succedere.
    const edges = graph().edges;
    const senzaDato = edges.filter((e) => e.lt === undefined);
    expect(senzaDato.length).toBeGreaterThan(0);
    expect(senzaDato.length).toBeLessThan(edges.length);
  });
});

describe('illuminazione lungo un percorso reale', () => {
  it('copre il percorso per intero, senza metri né secondi persi', () => {
    const metri = percorso.lighting.reduce((s, span) => s + span.distanceMeters, 0);
    const secondi = percorso.lighting.reduce((s, span) => s + span.durationSeconds, 0);

    expect(Math.abs(metri - percorso.distanceMeters)).toBeLessThan(2);
    expect(Math.abs(secondi - percorso.durationSeconds)).toBeLessThan(2);
  });

  it('unisce i tratti consecutivi con lo stesso stato', () => {
    for (let i = 1; i < percorso.lighting.length; i += 1) {
      expect(percorso.lighting[i]!.lit).not.toBe(percorso.lighting[i - 1]!.lit);
    }
  });

  it('dichiara i tratti in ordine di marcia, senza buchi', () => {
    let atteso = 0;
    for (const span of percorso.lighting) {
      expect(span.fromSeconds).toBeCloseTo(atteso, 5);
      atteso += span.durationSeconds;
    }
  });

  it('usa solo i tre stati previsti', () => {
    for (const span of percorso.lighting) {
      expect([true, false, null]).toContain(span.lit);
    }
  });

  it('su un percorso vero il conto del buio torna con la distanza', () => {
    // Partenza a tramonto avvenuto: tutto il percorso e' al buio, e le tre
    // voci devono ricomporre esattamente la distanza totale.
    const buio = darknessOnRoute({
      lighting: percorso.lighting,
      durationSeconds: percorso.durationSeconds,
      departure: new Date(2026, 8, 10, 21, 0, 0),
      sunset: new Date(2026, 8, 10, 19, 30, 0),
    });

    expect(buio).not.toBeNull();
    expect(buio!.startsInDark).toBe(true);
    expect(buio!.litMeters + buio!.unlitMeters + buio!.unknownMeters).toBe(buio!.darkMeters);
    expect(Math.abs(buio!.darkMeters - percorso.distanceMeters)).toBeLessThan(3);
  });
});
