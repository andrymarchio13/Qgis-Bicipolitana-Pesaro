/**
 * Test del router su grafi minimi costruiti apposta.
 *
 * Qui la risposta giusta e' calcolabile a mano: se un test fallisce, il motivo
 * e' il comportamento del router e non una particolarita' dei dati di Pesaro.
 */
import { describe, expect, it } from 'vitest';

import { WALKING_SPEED_KMH, WALK_ONLY_MAX_METERS } from '../../src/config';
import { attachEndpoints, isWalkEdge } from '../../src/services/routing/attach';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter } from '../../src/services/routing/router';
import type { RoutingGraph } from '../../src/types';
import { haversine, lineLength, projectOnLine } from '../../src/utils/geo';
import {
  GRAFO_DUE_ITINERARI,
  GRAFO_INNESTO_PERICOLOSO,
  GRAFO_DUE_LINEE,
  GRAFO_OSTACOLI,
  GRAFO_SCONNESSO,
  GRAFO_SENSO_UNICO,
  GRAFO_STRADA_CURVA,
  NODI_DUE_ITINERARI,
  NODI_INNESTO_PERICOLOSO,
  NODI_DUE_LINEE,
  NODI_OSTACOLI,
  NODI_SCONNESSO,
  NODI_SENSO_UNICO,
  NODI_STRADA_CURVA,
  PUNTO_FRA_LE_DUE_VIE,
  PUNTO_SULLA_CURVA,
  distanzaFraNodi,
  grafoSintetico,
} from '../fixtures/graph';
import { LINEE_DI_PROVA } from '../fixtures/lines';

const routerSu = (grafo: RoutingGraph): BicipolitanaRouter =>
  new BicipolitanaRouter(new RoutingGraphIndex(grafo), LINEE_DI_PROVA);

describe('scelta fra due itinerari equivalenti', () => {
  const router = routerSu(GRAFO_DUE_ITINERARI);
  const { nodes } = GRAFO_DUE_ITINERARI;
  const { OVEST, EST } = NODI_DUE_ITINERARI;

  it('il profilo Bicipolitana accetta il giro piu’ lungo sulla linea', () => {
    const [route] = router.route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['bicipolitana'],
    });
    expect(route.linesUsed).toEqual(['1']);
    expect(route.bicipolitanaPercentage).toBe(100);
    expect(route.walkingMeters).toBe(0);
  });

  it('il profilo veloce prende la strada piu’ corta', () => {
    const [route] = router.route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['fast'],
    });
    expect(route.linesUsed).toEqual([]);
    expect(route.bicipolitanaMeters).toBe(0);
    // La strada dritta misura quanto la distanza fra i due estremi.
    expect(route.distanceMeters).toBeCloseTo(distanzaFraNodi(GRAFO_DUE_ITINERARI, OVEST, EST), -1);
  });

  it('il percorso sulla linea e’ davvero piu’ lungo di quello su strada', () => {
    const [bici] = router.route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['bicipolitana'],
    });
    const [veloce] = router.route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['fast'],
    });
    expect(bici.distanceMeters).toBeGreaterThan(veloce.distanceMeters);
  });
});

describe('sensi unici', () => {
  const router = routerSu(GRAFO_SENSO_UNICO);
  const { nodes } = GRAFO_SENSO_UNICO;
  const { SUD, NORD } = NODI_SENSO_UNICO;

  it('nel verso consentito usa la via diretta', () => {
    const [route] = router.route({
      origin: nodes[SUD],
      destination: nodes[NORD],
      profiles: ['fast'],
    });
    expect(route.distanceMeters).toBeCloseTo(distanzaFraNodi(GRAFO_SENSO_UNICO, SUD, NORD), -1);
  });

  it('nel verso vietato fa il giro, non risale il senso unico', () => {
    const [route] = router.route({
      origin: nodes[NORD],
      destination: nodes[SUD],
      profiles: ['fast'],
    });
    const diretta = distanzaFraNodi(GRAFO_SENSO_UNICO, SUD, NORD);
    expect(route.distanceMeters).toBeGreaterThan(diretta * 1.5);
    expect(route.segments.flatMap((s) => s.streetNames)).toContain('Giro est nord');
  });
});

describe('rete non connessa', () => {
  const router = routerSu(GRAFO_SCONNESSO);
  const { nodes } = GRAFO_SCONNESSO;

  it('non inventa un percorso ciclabile fra due tratti scollegati', () => {
    const routes = router.route({
      origin: nodes[NODI_SCONNESSO.A_INIZIO],
      destination: nodes[NODI_SCONNESSO.B_FINE],
      profiles: ['bicipolitana', 'fast'],
    });

    /*
     * Fra i due tratti non esiste una strada percorribile, e il router non se
     * ne inventa una: quello che restituisce e' il cammino diretto, tutto
     * dichiarato a piedi e senza un metro di rete.
     */
    expect(routes).toHaveLength(1);
    expect(routes[0].onFoot).toBe(true);
    expect(routes[0].segments.every((s) => s.kind === 'piedi')).toBe(true);
    expect(routes[0].bicipolitanaMeters).toBe(0);
    expect(routes[0].linesUsed).toHaveLength(0);
    for (const instruction of routes[0].instructions) {
      expect(instruction.text).not.toMatch(/undefined|NaN|null/);
    }
  });

  it('lo restituisce a qualsiasi distanza, ma oltre i chilometri si pedala', () => {
    /*
     * Il collegamento diretto non ha tetto: meglio un percorso lungo, con la
     * sua distanza scritta, che un messaggio e una mappa vuota. Ma oltre
     * qualche chilometro non e' piu' un cammino — nessuno farebbe otto
     * chilometri a piedi per raggiungere una ciclabile — e viene dichiarato
     * per come si percorre: in bicicletta, fuori dalla rete.
     */
    const lontano: [number, number] = [
      nodes[NODI_SCONNESSO.B_FINE][0] + 0.1,
      nodes[NODI_SCONNESSO.B_FINE][1],
    ];
    const routes = router.route({
      origin: nodes[NODI_SCONNESSO.A_INIZIO],
      destination: lontano,
      profiles: ['fast'],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].direct).toBe(true);
    expect(routes[0].distanceMeters).toBeGreaterThan(WALK_ONLY_MAX_METERS);
    expect(routes[0].onFoot).toBeUndefined();
    expect(routes[0].segments.every((s) => s.transport === 'bici')).toBe(true);
    // Il tempo segue il mezzo dichiarato: a velocita' di cammino sarebbero ore.
    expect(routes[0].durationSeconds).toBeLessThan(
      (routes[0].distanceMeters / 1000 / WALKING_SPEED_KMH) * 3600,
    );
  });

  it('calcola invece il percorso interno a un singolo tratto', () => {
    const [route] = router.route({
      origin: nodes[NODI_SCONNESSO.A_INIZIO],
      destination: nodes[NODI_SCONNESSO.A_FINE],
      profiles: ['fast'],
    });
    expect(route.segments.length).toBe(1);
    expect(route.distanceMeters).toBeGreaterThan(0);
  });
});

describe('ostacoli dichiarati sugli archi', () => {
  const router = routerSu(GRAFO_OSTACOLI);
  const { nodes } = GRAFO_OSTACOLI;
  const { OVEST, EST } = NODI_OSTACOLI;

  it('riporta l’obbligo di scendere e l’id dell’ostacolo attraversato', () => {
    const [route] = router.route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['bicipolitana'],
    });
    expect(route.obstacleIds).toContain('obs-test-1');
    const avviso = route.warnings.find((w) => w.type === 'dismount');
    expect(avviso).toBeDefined();
    expect(avviso?.message).toMatch(/scendere/i);
  });

  it('segnala il transito vietato quando l’arco lo dichiara', () => {
    // Stesso scenario, con la chicane marcata come non transitabile.
    const grafo = grafoSintetico(nodes, [
      { da: 0, a: 1, tipo: 0, linea: '2', nome: 'Linea 2 ovest' },
      { da: 1, a: 2, tipo: 0, linea: '2', nome: 'Linea 2 est', ostacoli: ['obs-test-2'], vietato: true },
    ]);
    const [route] = routerSu(grafo).route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['bicipolitana'],
    });
    const avviso = route.warnings.find((w) => w.type === 'blocked');
    expect(avviso).toBeDefined();
    expect(avviso?.message).toMatch(/non transitabil/i);
    expect(avviso?.location).toBeDefined();
  });

  it('non produce avvisi quando gli archi non dichiarano ostacoli', () => {
    const grafo = grafoSintetico(nodes, [
      { da: 0, a: 3, nome: 'Giro sud ovest' },
      { da: 3, a: 2, nome: 'Giro sud est' },
    ]);
    const [route] = routerSu(grafo).route({
      origin: nodes[OVEST],
      destination: nodes[EST],
      profiles: ['fast'],
    });
    expect(route.warnings).toEqual([]);
    expect(route.obstacleIds).toEqual([]);
  });
});

describe('cambi di linea', () => {
  const router = routerSu(GRAFO_DUE_LINEE);
  const { nodes } = GRAFO_DUE_LINEE;

  it('elenca le linee nell’ordine in cui vengono percorse', () => {
    const [route] = router.route({
      origin: nodes[NODI_DUE_LINEE.PARTENZA],
      destination: nodes[NODI_DUE_LINEE.ARRIVO_SUD],
      profiles: ['bicipolitana'],
    });
    expect(route.linesUsed).toEqual(['1', '2']);
    expect(route.segments.map((s) => s.lineId)).toEqual(['1', '2']);
    // Il nome mostrato viene dalla mappa delle linee, non dall'id dell'arco.
    expect(route.segments.map((s) => s.lineName)).toEqual(['Linea 1', 'Linea 2']);
  });

  it('resta su una sola linea quando la destinazione e’ sul suo ramo', () => {
    const [route] = router.route({
      origin: nodes[NODI_DUE_LINEE.PARTENZA],
      destination: nodes[NODI_DUE_LINEE.ARRIVO_NORD],
      profiles: ['bicipolitana'],
    });
    expect(route.linesUsed).toEqual(['1']);
  });
});

describe('tratto a piedi verso la rete', () => {
  const grafo = GRAFO_STRADA_CURVA;
  const index = new RoutingGraphIndex(grafo);
  const router = routerSu(grafo);
  const strada = grafo.edges[0].g;

  it('segue la curva della strada invece di tagliare dritto', () => {
    const snap = index.snap(PUNTO_SULLA_CURVA, 2000)!;
    expect(snap).not.toBeNull();

    // Il raccordo fino alla strada e' corto: il punto e' praticamente sopra.
    expect(snap.offNetworkMeters).toBeLessThan(60);
    // Il cammino ha i vertici della curva, non due soli punti.
    expect(snap.walkPath.length).toBeGreaterThan(2);
    for (const vertice of snap.walkPath.slice(1)) {
      expect(projectOnLine(vertice, strada).distanceMeters).toBeLessThan(1);
    }
    // Ed e' piu' lungo della linea d'aria, perche' la strada gira.
    const inLineaDAria = haversine(PUNTO_SULLA_CURVA, index.nodes[snap.nodeId]);
    expect(snap.distanceMeters).toBeGreaterThan(inLineaDAria);
    expect(snap.distanceMeters).toBeCloseTo(lineLength(snap.walkPath), 6);
  });

  it('stando sulla strada non fa camminare: il percorso parte da lì', () => {
    /*
     * Il punto e' praticamente sopra la strada. Il percorso vi si innesta nel
     * punto in cui la incontra, non al primo nodo utile: chi si trova a meta'
     * di una via non deve percorrerla a piedi fino all'incrocio prima di poter
     * salire in sella.
     */
    const [route] = router.route({
      origin: PUNTO_SULLA_CURVA,
      destination: grafo.nodes[NODI_STRADA_CURVA.NORD],
      profiles: ['fast'],
    });

    const piedi = route.segments.filter((s) => s.kind === 'piedi');
    const aPiedi = piedi.reduce((sum, s) => sum + s.distanceMeters, 0);
    // Il raccordo, se c'e', e' la sola distanza dal punto alla strada.
    expect(aPiedi).toBeLessThan(60);
    // E comunque mai piu' lungo del cammino fino al nodo piu' vicino, che e'
    // quello che il percorso imponeva prima di innestarsi a meta' arco.
    const alNodo = index.nearestNode(PUNTO_SULLA_CURVA, 2000)!.distanceMeters;
    expect(aPiedi).toBeLessThanOrEqual(alNodo);

    expect(route.geometry[0]).toEqual(PUNTO_SULLA_CURVA);
    // La geometria non ripete il punto di giunzione fra i due tratti.
    expect(lineLength(route.geometry)).toBeCloseTo(route.distanceMeters, 0);
  });

  it('non aggiunge un tratto a piedi quando si parte da un nodo', () => {
    const [route] = router.route({
      origin: grafo.nodes[NODI_STRADA_CURVA.INIZIO],
      destination: grafo.nodes[NODI_STRADA_CURVA.NORD],
      profiles: ['fast'],
    });
    expect(route.walkingMeters).toBe(0);
    expect(route.segments.every((s) => s.kind !== 'piedi')).toBe(true);
  });
});

describe('dove il percorso si innesta sulla rete', () => {
  const grafo = GRAFO_INNESTO_PERICOLOSO;
  const index = new RoutingGraphIndex(grafo);
  const router = routerSu(grafo);

  it('il collegamento verso la strada pericolosa costa più di quello verso la ciclabile', () => {
    const attached = attachEndpoints(
      index,
      PUNTO_FRA_LE_DUE_VIE,
      grafo.nodes[NODI_INNESTO_PERICOLOSO.EST],
    );
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;

    const collegamenti = attached.graph.adjacency[attached.graph.origin.node]
      .map((entry) => entry.edge)
      .filter(isWalkEdge);
    // Entrambe le vie sono a portata: il calcolo deve poter scegliere.
    expect(collegamenti.length).toBeGreaterThanOrEqual(2);

    const perMetro = (edge: (typeof collegamenti)[number]): number => edge.t / edge.d;
    const versoStrada = collegamenti.reduce((a, b) => (a.d < b.d ? a : b));
    const versoCiclabile = collegamenti.reduce((a, b) => (a.d > b.d ? a : b));

    // La strada e' molto piu' vicina, quindi il collegamento e' piu' corto...
    expect(versoStrada.d).toBeLessThan(versoCiclabile.d);
    // ...ma ogni metro percorso lungo il traffico costa di piu'.
    expect(perMetro(versoStrada)).toBeGreaterThan(perMetro(versoCiclabile) * 2);
  });

  it('preferisce entrare in rete dalla ciclabile, non dalla strada a scorrimento', () => {
    const [route] = router.route({
      origin: PUNTO_FRA_LE_DUE_VIE,
      destination: grafo.nodes[NODI_INNESTO_PERICOLOSO.EST],
      profiles: ['bicipolitana'],
    });

    const vie = route.segments.flatMap((s) => s.streetNames);
    expect(vie).toContain('Ciclabile di prova');
    expect(vie).not.toContain('Strada a scorrimento di prova');

    // Il cammino e' piu' lungo del minimo possibile, ed e' una scelta: porta
    // dove si puo' camminare, non dove la rete e' semplicemente piu' vicina.
    const piuVicina = index.attachments(PUNTO_FRA_LE_DUE_VIE, 2000, 1)[0].offNetworkMeters;
    expect(route.walkingMeters).toBeGreaterThan(piuVicina);
    // Ma resta dentro il margine oltre il quale gli innesti non si valutano.
    expect(route.walkingMeters).toBeLessThan(piuVicina + 150);
  });
});
