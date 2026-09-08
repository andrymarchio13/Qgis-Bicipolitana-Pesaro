/**
 * Alternative di percorso.
 *
 * I quattro profili non bastano: dove esiste un corridoio evidente ci
 * finiscono tutti, e chi guarda la mappa vede un percorso solo. Qui si
 * verifica che il router ne proponga davvero piu' d'uno e che quelli proposti
 * siano strade diverse, non la stessa strada ripetuta con un'altra etichetta.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  MAX_ROUTE_ALTERNATIVES,
  ROUTE_SIMILARITY_THRESHOLD,
} from '../../src/config';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter } from '../../src/services/routing/router';
import type { LngLat, Route } from '../../src/types';
import { lineLength } from '../../src/utils/geo';
import { graph, linesFile, PLACES, PLACES_FUORI_RETE } from '../helpers';

let router: BicipolitanaRouter;

beforeAll(() => {
  const index = new RoutingGraphIndex(graph());
  const lines = new Map(linesFile().lines.map((l) => [l.id, l]));
  router = new BicipolitanaRouter(index, lines);
});

/**
 * Coppie di partenza e arrivo distribuite sulla citta': lungomare, entroterra,
 * quartieri e un punto fuori dall'area coperta dai dati. Se le alternative
 * funzionassero solo sul centro non servirebbero a molto.
 */
const COPPIE: [string, LngLat, LngLat][] = [
  ['lungomare -> Villa Fastiggi', PLACES.lungomareTrieste, PLACES.villaFastiggi],
  ['Piazzale Libertà -> Cattabrighe', PLACES.piazzaleLiberta, PLACES.cattabrighe],
  ['Viale Vittoria -> via Lombroso', PLACES.vialeVittoria, PLACES.viaLombroso],
  ['San Decenzio -> San Bartolo', PLACES.parcheggioSanDecenzio, PLACES.belvedereSanBartolo],
  ['fuori rete -> lungomare', PLACES_FUORI_RETE.caseBruciate, PLACES.lungomareTrieste],
];

/** Frazione di punti che due percorsi hanno in comune. */
const sovrapposizione = (a: Route, b: Route): number => {
  const chiave = (p: LngLat): string => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const insieme = new Set(b.geometry.map(chiave));
  const comuni = a.geometry.filter((p) => insieme.has(chiave(p))).length;
  return comuni / a.geometry.length;
};

describe('alternative di percorso', () => {
  it.each(COPPIE)('propone piu di un percorso: %s', (_nome, origin, destination) => {
    const routes = router.route({ origin, destination });
    expect(routes.length).toBeGreaterThan(1);
    expect(routes.length).toBeLessThanOrEqual(MAX_ROUTE_ALTERNATIVES);
  });

  it.each(COPPIE)('le alternative sono strade diverse: %s', (_nome, origin, destination) => {
    const routes = router.route({ origin, destination });

    // Nessuna geometria ripetuta identica.
    const geometrie = new Set(routes.map((r) => JSON.stringify(r.geometry)));
    expect(geometrie.size).toBe(routes.length);

    // Nessuna coppia praticamente sovrapposta. La soglia sui punti e' piu'
    // larga di quella sugli archi usata dal router: due percorsi possono
    // condividere legittimamente gli imbocchi e il raccordo fuori rete.
    for (let i = 0; i < routes.length; i += 1) {
      for (let j = i + 1; j < routes.length; j += 1) {
        const comune = Math.max(
          sovrapposizione(routes[i], routes[j]),
          sovrapposizione(routes[j], routes[i]),
        );
        expect(comune).toBeLessThan(0.97);
      }
    }
  });

  it('ogni alternativa e un percorso completo e coerente', () => {
    const routes = router.route({
      origin: PLACES.lungomareTrieste,
      destination: PLACES.villaFastiggi,
    });

    for (const route of routes) {
      expect(route.geometry.length).toBeGreaterThan(1);
      expect(route.segments.length).toBeGreaterThan(0);
      expect(route.instructions.length).toBeGreaterThan(1);
      expect(route.distanceMeters).toBeGreaterThan(0);
      expect(route.durationSeconds).toBeGreaterThan(0);
      expect(route.profileLabel).toBeTruthy();
      expect(route.profileLabel).not.toContain('undefined');

      // La distanza dichiarata deve corrispondere alla geometria (±3%).
      const misurata = lineLength(route.geometry);
      expect(Math.abs(misurata - route.distanceMeters) / route.distanceMeters).toBeLessThan(0.03);
    }

    // Gli identificativi servono a selezionare il percorso: devono essere unici.
    expect(new Set(routes.map((r) => r.id)).size).toBe(routes.length);
  });

  it('le varianti sono dichiarate come tali, non spacciate per profili', () => {
    const routes = router.route({
      origin: PLACES.piazzaleLiberta,
      destination: PLACES.cattabrighe,
    });
    const varianti = routes.filter((r) => r.isVariant);
    expect(varianti.length).toBeGreaterThan(0);
    for (const variante of varianti) {
      expect(variante.profileLabel).toMatch(/^Alternativa \d+$/);
    }
    // Le etichette non si ripetono: due schede uguali non sono una scelta.
    const etichette = routes.map((r) => r.profileLabel);
    expect(new Set(etichette).size).toBe(etichette.length);
  });

  it('il primo percorso resta quello sulla Bicipolitana', () => {
    const routes = router.route({
      origin: PLACES.lungomareTrieste,
      destination: PLACES.villaFastiggi,
    });
    expect(routes[0].profile).toBe('bicipolitana');
    expect(routes[0].isVariant).toBe(false);
  });

  it('rispetta il numero massimo richiesto', () => {
    const uno = router.route({
      origin: PLACES.lungomareTrieste,
      destination: PLACES.villaFastiggi,
      maxAlternatives: 1,
    });
    expect(uno).toHaveLength(1);

    const tre = router.route({
      origin: PLACES.lungomareTrieste,
      destination: PLACES.villaFastiggi,
      maxAlternatives: 3,
    });
    expect(tre.length).toBeLessThanOrEqual(3);
  });

  it('il ricalcolo in navigazione resta una risposta sola', () => {
    const route = router.reroute(
      PLACES.vialeRisorgimento,
      PLACES.viaLombroso,
      'bicipolitana',
      null,
    );
    expect(route).not.toBeNull();
    expect(route?.geometry.length).toBeGreaterThan(1);
  });

  it('la soglia di somiglianza resta un valore sensato', () => {
    expect(ROUTE_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(ROUTE_SIMILARITY_THRESHOLD).toBeLessThan(1);
  });
});
