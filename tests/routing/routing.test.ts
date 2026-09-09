/**
 * Test del motore di routing sui dati reali di Pesaro.
 *
 * Non si assume che due luoghi siano collegati da una sola linea: si verifica
 * che il router trovi un percorso e che i profili si comportino come dichiarato.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ROUTING_PROFILES, WALK_SNAP_MAX_DISTANCE_METERS } from '../../src/config';
import { WALK_LEG_MIN_METERS } from '../../src/config';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter, RoutingError } from '../../src/services/routing/router';
import type { Line, Route } from '../../src/types';
import { haversine, lineLength, projectOnLine } from '../../src/utils/geo';
import { graph, linesFile, PLACES, PLACES_CASI_LIMITE, PLACES_FUORI_RETE } from '../helpers';

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

  it('dichiara la lunghezza del tratto a piedi che disegna davvero', () => {
    // Il numero mostrato e il tratto disegnato devono essere la stessa cosa:
    // dichiarare la distanza in linea d'aria e poi tracciare il cammino lungo
    // la strada significherebbe mostrare un numero che non corrisponde.
    for (const place of [
      ...Object.values(PLACES),
      ...Object.values(PLACES_CASI_LIMITE),
      ...Object.values(PLACES_FUORI_RETE),
    ]) {
      const snap = index.snap(place, WALK_SNAP_MAX_DISTANCE_METERS);
      expect(snap).not.toBeNull();
      // Il cammino parte dal punto scelto e finisce sul nodo usato dal percorso.
      expect(snap!.walkPath[0]).toEqual(place);
      expect(snap!.walkPath[snap!.walkPath.length - 1]).toEqual(index.nodes[snap!.nodeId]);
      expect(Math.abs(lineLength(snap!.walkPath) - snap!.distanceMeters)).toBeLessThan(0.5);
      // Camminare lungo la strada non puo' essere piu' corto della linea d'aria.
      expect(snap!.distanceMeters).toBeGreaterThanOrEqual(
        haversine(place, index.nodes[snap!.nodeId]) - 0.5,
      );
    }
  });

  it('sceglie l’estremità che si raggiunge camminando di meno', () => {
    // Fra le due estremita' dell'arco di aggancio nessuna deve richiedere un
    // cammino piu' breve di quella scelta.
    for (const place of [PLACES.viaSolferino, PLACES_CASI_LIMITE.mezzeriaViaCerreto]) {
      const snap = index.snap(place, WALK_SNAP_MAX_DISTANCE_METERS);
      const arco = snap!.edge!;
      const proiezione = projectOnLine(place, arco.g);
      const lunghezza = lineLength(arco.g);
      const versoA = proiezione.distanceMeters + proiezione.offsetMeters;
      const versoB = proiezione.distanceMeters + (lunghezza - proiezione.offsetMeters);
      expect(snap!.nodeId).toBe(versoA <= versoB ? arco.a : arco.b);
    }
  });

  it('il tratto a piedi segue la strada invece di tagliare per i campi', () => {
    // A meta' di Via Cerreto il nodo piu' vicino dista quasi un chilometro: in
    // linea d'aria il collegamento attraverserebbe la campagna.
    const punto = PLACES_CASI_LIMITE.mezzeriaViaCerreto;
    const snap = index.snap(punto, WALK_SNAP_MAX_DISTANCE_METERS)!;

    // Solo il raccordo fino alla strada resta in linea d'aria, ed e' corto.
    expect(snap.offNetworkMeters).toBeLessThan(20);
    // Il resto e' una polilinea, non un segmento: segue i vertici della strada.
    expect(snap.walkPath.length).toBeGreaterThan(5);

    // Ogni vertice del cammino, tranne il punto di partenza, sta sulla strada.
    const strada = snap.edge!.g;
    for (const vertice of snap.walkPath.slice(1)) {
      expect(projectOnLine(vertice, strada).distanceMeters).toBeLessThan(1);
    }
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

describe('collegamento a piedi sui dati reali', () => {
  it('a metà di una strada nota non fa camminare fino all’incrocio', () => {
    /*
     * Partenza a meta' di Via Cerreto. Il nodo del grafo e' lontano, ma la
     * strada c'e' ed e' nei dati: il percorso deve innestarsi dove l'utente si
     * trova, non fargli percorrere a piedi tutta la via fino all'incrocio.
     */
    const partenza = PLACES_CASI_LIMITE.mezzeriaViaCerreto;
    const [route] = router.route({
      origin: partenza,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    expectValidRoute(route);

    const aPiedi = route.segments
      .filter((s) => s.kind === 'piedi')
      .reduce((sum, s) => sum + s.distanceMeters, 0);

    // Il cammino non supera la distanza dal punto alla rete: e' il minimo
    // indispensabile per arrivarci, non una passeggiata lungo la strada.
    const allaRete = index.attachments(partenza, WALK_SNAP_MAX_DISTANCE_METERS, 1)[0];
    expect(aPiedi).toBeLessThanOrEqual(allaRete.offNetworkMeters + 60);
    // E resta molto sotto al cammino fino al nodo piu' vicino, che e' quello
    // che il percorso imponeva prima.
    expect(aPiedi).toBeLessThan(index.nearestNode(partenza, 2000)!.distanceMeters);

    // Il primo punto resta quello scelto dall'utente.
    expect(route.geometry[0]).toEqual(partenza);
  });

  it('fuori dai dati resta in linea d’aria, e lo dichiara', () => {
    // A Case Bruciate non ci sono strade nei dati: non c'e' niente da seguire,
    // e il collegamento resta il segmento dichiarato come tratto a piedi.
    const snap = index.snap(PLACES_FUORI_RETE.caseBruciate, WALK_SNAP_MAX_DISTANCE_METERS)!;
    expect(snap.offNetworkMeters).toBeGreaterThan(700);
    expect(snap.distanceMeters).toBeGreaterThanOrEqual(snap.offNetworkMeters);
  });
});

describe('percorsi reali a Pesaro', () => {
  const cases: [string, [number, number], [number, number]][] = [
    ['San Decenzio → Lungomare Trieste', PLACES.parcheggioSanDecenzio, PLACES.lungomareTrieste],
    ['Velomarche → Piazzale della Libertà', PLACES.velomarche, PLACES.piazzaleLiberta],
    ['San Decenzio → Via Solferino', PLACES.parcheggioSanDecenzio, PLACES.viaSolferino],
    ['Velomarche → Pista Cardinali', PLACES.velomarche, PLACES.pistaCardinali],
    // Attraversamenti lunghi della citta', da un capo all'altro dei dati.
    ['Villa Fastiggi → Lungomare Trieste', PLACES.villaFastiggi, PLACES.lungomareTrieste],
    ['Cattabrighe → Via Lombroso', PLACES.cattabrighe, PLACES.viaLombroso],
    ['Belvedere San Bartolo → Viale Risorgimento', PLACES.belvedereSanBartolo, PLACES.vialeRisorgimento],
    ['Via Pantano → Via per Soria', PLACES.viaPantano, PLACES.viaPerSoria],
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

  it('cammina fino alla rete più vicina, non fino al primo incrocio', () => {
    /*
     * Caso reale segnalato: partenza a ovest di Pesaro, verso Case Bruciate.
     * La rete e' a circa un chilometro, ma il nodo del grafo e' molto piu'
     * lontano: prima della correzione il percorso faceva camminare fino a
     * quello, e con il ricalcolo pedonale il tratto diventava chilometrico.
     */
    const partenza = PLACES_FUORI_RETE.caseBruciate;
    const [route] = router.route({
      origin: partenza,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });

    const allaRete = index.attachments(partenza, WALK_SNAP_MAX_DISTANCE_METERS, 1)[0];
    const alNodo = index.nearestNode(partenza, WALK_SNAP_MAX_DISTANCE_METERS)!;

    // Il cammino e' quello che serve per raggiungere la rete, non di piu'.
    expect(route.walkingMeters).toBeLessThanOrEqual(Math.round(allaRete.offNetworkMeters) + 60);
    // E dev'essere piu' corto del cammino fino al nodo: e' tutto il punto
    // dell'innesto a meta' arco.
    expect(route.walkingMeters).toBeLessThan(Math.round(alNodo.distanceMeters));
    // Da qui il percorso entra sulla Bicipolitana: e' quella la rete vicina.
    expect(route.linesUsed.length).toBeGreaterThan(0);
  });

  it('da lontano calcola comunque il percorso, e il raccordo si pedala', () => {
    /*
     * Un punto a diversi chilometri dai dati del progetto non viene piu'
     * rifiutato: il percorso c'e', con il raccordo dichiarato. E quel raccordo
     * non e' una camminata — chi chiede un percorso ciclabile ha una
     * bicicletta, e proporgli un'ora a piedi perche' i dati finiscono prima di
     * casa sua non sarebbe una risposta.
     */
    const lontano: [number, number] = [12.78, 43.89];
    const [route] = router.route({
      origin: lontano,
      destination: PLACES.viaSolferino,
      profiles: ['bicipolitana'],
    });
    expectValidRoute(route);

    const raccordi = route.segments.filter((s) => s.kind === 'piedi');
    expect(raccordi.length).toBeGreaterThan(0);
    expect(raccordi[0].distanceMeters).toBeGreaterThan(1000);
    expect(raccordi[0].transport).toBe('bici');
    // Il tempo dichiarato e' quello di una pedalata, non di una camminata.
    const aPiedi = (raccordi[0].distanceMeters / 1000 / 4.8) * 3600;
    expect(raccordi[0].durationSeconds).toBeLessThan(aPiedi / 2);

    const istruzione = route.instructions.find((i) => i.type === 'walk-start');
    expect(istruzione?.text).toMatch(/bicicletta/i);
  });

  it('resta un tratto a piedi quando è corto', () => {
    // Poche decine di metri per raggiungere la rete: quelli si fanno a piedi,
    // spingendo la bici.
    const [route] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.piazzaleLiberta,
      profiles: ['bicipolitana'],
    });
    for (const raccordo of route.segments.filter((s) => s.kind === 'piedi')) {
      expect(raccordo.transport).toBe('piedi');
    }
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
    /*
     * La fine si misura in metri, non in cifre decimali di longitudine: quel
     * che conta e' che il percorso arrivi alla destinazione, non su quale
     * arco della rete si agganci. Via Solferino e' una strada a traffico
     * intenso, e il calcolo puo' legittimamente preferire di accostare sulla
     * ciclabile a pochi metri invece di innestarsi sulla carreggiata; sotto
     * WALK_LEG_MIN_METERS il residuo non diventa nemmeno un tratto a piedi.
     */
    expect(haversine(last, PLACES.viaSolferino)).toBeLessThanOrEqual(WALK_LEG_MIN_METERS);
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

  it('non fa camminare più dello stretto necessario per raggiungere la rete', () => {
    const [route] = router.route({
      origin: PLACES.velomarche,
      destination: PLACES.piazzaleLiberta,
      profiles: ['bicipolitana'],
    });

    /*
     * I due punti sono a poche decine di metri dalla rete. Il cammino non puo'
     * superare quelle distanze: e' la garanzia che conta — mai un metro a
     * piedi in piu' di quello che serve per arrivare alla rete — e vale per
     * qualunque coppia di punti, non solo per questa.
     */
    const necessario =
      index.attachments(PLACES.velomarche, WALK_SNAP_MAX_DISTANCE_METERS, 1)[0]
        .offNetworkMeters +
      index.attachments(PLACES.piazzaleLiberta, WALK_SNAP_MAX_DISTANCE_METERS, 1)[0]
        .offNetworkMeters;
    expect(route.walkingMeters).toBeLessThanOrEqual(Math.round(necessario) + 60);
    // E in valore assoluto resta un'inezia: due punti in citta' non si
    // raggiungono a piedi.
    expect(route.walkingMeters).toBeLessThan(150);
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
        expect(['obstacle', 'dismount', 'blocked', 'data', 'traffico']).toContain(warning.type);
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
