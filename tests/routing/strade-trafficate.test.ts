/**
 * Esposizione alle strade a traffico intenso.
 *
 * Statali e provinciali — nel grafo: `primary`, `secondary` e affini — sono
 * percorribili in bicicletta ma non sono un percorso ciclabile: affiancare le
 * auto sulla Adriatica o sulla Provinciale 423 e' esattamente cio' che questa
 * applicazione dovrebbe evitare.
 *
 * Il costo di un arco penalizza la pericolosita' in modo piu' che
 * proporzionale (DANGER_BOOST): senza quel termine la penalita' era lineare e
 * una statale costava appena il 24% piu' di una via residenziale, tanto che
 * bastava fosse il 19% piu' corta perche' il calcolo la preferisse.
 *
 * Questi test fissano il risultato su tragitti reali, cosi' che una modifica
 * al modello di costo non riporti silenziosamente i percorsi sulle statali.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CYCLING_SPEED_KMH,
  MAX_ROUTE_ALTERNATIVES,
  ROUTING_PROFILES,
} from '../../src/config';
import { edgeCost, findPath } from '../../src/services/routing/astar';
import { isBusyRoad } from '../../src/services/routing/busy';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter } from '../../src/services/routing/router';
import type { Line, Route, RoutingProfileId } from '../../src/types';
import { graph, linesFile, PLACES } from '../helpers';

let index: RoutingGraphIndex;
let router: BicipolitanaRouter;

beforeAll(() => {
  index = new RoutingGraphIndex(graph());
  const lines = new Map(linesFile().lines.map((l: Line) => [l.id, l]));
  router = new BicipolitanaRouter(index, lines);
});

/** Tragitti lunghi da un capo all'altro della citta': i piu' esposti alla tentazione della statale. */
const TRAGITTI: [string, [number, number], [number, number]][] = [
  ['Cattabrighe → via Lombroso', PLACES.cattabrighe, PLACES.viaLombroso],
  ['Villa Fastiggi → lungomare', PLACES.villaFastiggi, PLACES.lungomareTrieste],
  ['Ardizio → pista Cardinali', PLACES.panoramicaArdizio, PLACES.pistaCardinali],
  ['Santa Maria → via Lombroso', PLACES.santaMariaFabbrecce, PLACES.viaLombroso],
  ['Solferino → Cattabrighe', PLACES.viaSolferino, PLACES.cattabrighe],
  ['Lungo Genica → lungomare', PLACES.lungoGenica, PLACES.lungomareTrieste],
  ['Miralfiore → Ardizio', PLACES.viaMiralfiore, PLACES.panoramicaArdizio],
  ['via Pantano → Cattabrighe', PLACES.viaPantano, PLACES.cattabrighe],
];

/** Metri percorsi su strade a traffico intenso, e metri totali, per un profilo. */
function esposizione(profileId: RoutingProfileId): { trafficate: number; totali: number } {
  let trafficate = 0;
  let totali = 0;
  for (const [, origine, destinazione] of TRAGITTI) {
    const a = index.nearestNode(origine, 2000);
    const b = index.nearestNode(destinazione, 2000);
    if (!a || !b) continue;
    const risultato = findPath(index, a.nodeId, b.nodeId, {
      profile: ROUTING_PROFILES[profileId],
      cyclingSpeedKmh: CYCLING_SPEED_KMH,
    });
    if (!risultato) continue;
    for (const passo of risultato.steps) {
      totali += passo.edge.d;
      if (isBusyRoad(passo.edge)) trafficate += passo.edge.d;
    }
  }
  return { trafficate, totali };
}

const quota = (id: RoutingProfileId): number => {
  const { trafficate, totali } = esposizione(id);
  return trafficate / totali;
};

describe('esposizione alle strade a traffico intenso', () => {
  it('il profilo predefinito resta ampiamente sotto il 5% del percorso', () => {
    // Misurato al 2,9%: la soglia lascia margine alle rigenerazioni dei dati
    // senza tollerare un ritorno al comportamento lineare, che dava il 6,2%.
    expect(quota('bicipolitana')).toBeLessThan(0.05);
  });

  it('i profili tranquillo e sicuro sono i meno esposti', () => {
    const sicuro = quota('safe');
    const tranquillo = quota('quiet');
    expect(sicuro).toBeLessThan(0.03);
    expect(tranquillo).toBeLessThan(0.03);
    // Chi chiede il percorso piu' sicuro non deve ricevere piu' statale di
    // chi chiede il piu' veloce.
    expect(sicuro).toBeLessThanOrEqual(quota('fast'));
  });

  it('la pericolosita' + '\u2019 pesa piu\u2019 che proporzionalmente', () => {
    // Confronto diretto fra due archi reali: una primary e una residential.
    const g = graph();
    const primary = g.edges.find((e) => e.hw === 'primary' && e.s <= 0.15);
    const residential = g.edges.find((e) => e.hw === 'residential' && e.s >= 0.55);
    expect(primary, 'nessun arco primary nel grafo').toBeDefined();
    expect(residential, 'nessun arco residential nel grafo').toBeDefined();
    const profilo = ROUTING_PROFILES.bicipolitana;
    /*
     * Il confronto usa la funzione di costo vera, non una sua copia: una
     * formula riscritta qui continuerebbe a passare anche dopo che il modello
     * e' cambiato, cioe' proprio quando il test dovrebbe accorgersene. I due
     * archi vengono normalizzati a un secondo di percorrenza per isolare la
     * pericolosita' dalla lunghezza.
     */
    const perSecondo = (arco: typeof primary): number =>
      edgeCost({ ...arco!, t: 1, o: undefined, dm: undefined, l: undefined }, profilo, null);
    const rapporto = perSecondo(primary) / perSecondo(residential);
    // Con la penalita' lineare il rapporto era 1,24: una statale piu' corta
    // del 19% vinceva. Ora deve servire uno scarto molto piu' grande.
    expect(rapporto).toBeGreaterThan(1.6);
  });
});

describe('esclusione delle statali e delle provinciali', () => {
  /*
   * Il grafo marca le strade a traffico intenso con `bs`, partendo dal
   * riferimento amministrativo OSM. Prima che quel flag esistesse i percorsi
   * infilavano la Statale 746 e la Provinciale 423 — il corridoio fra Villa
   * Ceccolini e Villa Fastiggi — perche' erano solo "un po' piu' care": un
   * itinerario che nessuno percorrerebbe in bicicletta.
   */
  it('il grafo marca davvero la SS746 e la SP423', () => {
    const riferimenti = new Set(
      graph()
        .edges.filter((e) => isBusyRoad(e))
        .map((e) => e.rf)
        .filter((rf): rf is string => !!rf),
    );
    expect(riferimenti).toContain('SS746');
    expect(riferimenti).toContain('SP423');
  });

  it('il divieto e’ un divieto: non un metro, mai', () => {
    /*
     * Cercato con `busyRoads: 'forbid'`, un percorso o non contiene nemmeno un
     * metro di strada a traffico intenso o non esiste. Il secondo caso e' reale
     * — qui i due punti si agganciano al nodo piu' vicino, che a Cattabrighe o
     * sulla Panoramica Ardizio e' sulla statale stessa — ed e' esattamente
     * quello in cui il router ripiega sul tentativo a caro prezzo.
     */
    let senzaStatali = 0;
    for (const [nome, origine, destinazione] of TRAGITTI) {
      const a = index.nearestNode(origine, 2000);
      const b = index.nearestNode(destinazione, 2000);
      if (!a || !b) continue;
      const risultato = findPath(index, a.nodeId, b.nodeId, {
        profile: ROUTING_PROFILES.bicipolitana,
        cyclingSpeedKmh: CYCLING_SPEED_KMH,
        busyRoads: 'forbid',
      });
      if (!risultato) continue;
      senzaStatali += 1;
      const trafficati = risultato.steps
        .filter((passo) => isBusyRoad(passo.edge))
        .reduce((somma, passo) => somma + passo.edge.d, 0);
      expect(trafficati, `${nome}: ${Math.round(trafficati)} m di strade trafficate`).toBe(0);
    }
    expect(senzaStatali, 'nessun tragitto percorribile senza statali').toBeGreaterThan(0);
  });

  it('quel che resta di statale e’ poco e dichiarato', () => {
    /*
     * Dove la statale e' inevitabile — l'aggancio di una frazione, un ponte sul
     * Foglia — il percorso ne usa il minimo e lo scrive nell'avviso. La misura
     * si legge dall'avviso stesso, calcolato sugli archi realmente percorsi,
     * invece di essere ristimata qui con una formula parallela.
     */
    const trafficati = (percorso: Route): number => {
      const avviso = percorso.warnings.find((w) => w.type === 'traffico');
      if (!avviso) return 0;
      const trovato = /(\d+) m di strade a traffico intenso/.exec(avviso.message);
      return trovato ? Number(trovato[1]) : 0;
    };

    for (const [nome, origine, destinazione] of TRAGITTI) {
      const percorsi = router.route({ origin: origine, destination: destinazione });
      expect(percorsi.length, `${nome}: nessun percorso`).toBeGreaterThan(0);
      for (const percorso of percorsi) {
        // Misurato al massimo a 226 m, sul solo aggancio di Santa Maria
        // Fabbrecce. Prima del divieto erano chilometri.
        expect(
          trafficati(percorso),
          `${nome} (${percorso.profileLabel}): troppa strada a traffico intenso`,
        ).toBeLessThan(400);
      }
    }
  });

  it('i percorsi proposti non nominano la SS746 ne’ la SP423', () => {
    // I due nomi del corridoio fra Villa Ceccolini e Villa Fastiggi, quello
    // della segnalazione: nel grafo sono SS746 e SP423.
    const VIETATE = ['Strada delle Regioni', 'Strada di Montefeltro'];
    for (const [nome, origine, destinazione] of TRAGITTI) {
      const percorsi = router.route({ origin: origine, destination: destinazione });
      for (const percorso of percorsi) {
        const vie = new Set(percorso.segments.flatMap((s) => s.streetNames));
        for (const vietata of VIETATE) {
          expect(
            vie.has(vietata),
            `${nome} (${percorso.profileLabel}): passa per ${vietata}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('avviso sulle strade a traffico intenso', () => {
  it('dichiara i metri e i nomi quando il percorso ci passa davvero', () => {
    /*
     * Alcuni tratti sono obbligati: sulla Provinciale 423 sette degli otto
     * nodi del grafo hanno grado <= 2, cioe' non esiste alternativa. In quei
     * casi l'unica risposta onesta e' dichiararlo.
     */
    const percorsi = router.route({
      origin: PLACES.villaFastiggi,
      destination: PLACES.panoramicaArdizio,
      maxAlternatives: 6,
    });
    const conTraffico = percorsi.filter((r) =>
      r.warnings.some((w) => w.type === 'traffico'),
    );
    for (const percorso of conTraffico) {
      const avviso = percorso.warnings.find((w) => w.type === 'traffico');
      expect(avviso?.message).toMatch(/\d+ m di strade a traffico intenso/);
      expect(avviso?.location).toBeDefined();
    }
  });

  it('non inventa l’avviso su un percorso interamente in sede protetta', () => {
    const percorsi = router.route({
      origin: PLACES.pistaCardinali,
      destination: PLACES.cattabrighe,
      profiles: ['safe'],
    });
    for (const percorso of percorsi) {
      const avviso = percorso.warnings.find((w) => w.type === 'traffico');
      if (!avviso) continue;
      // Se l'avviso c'e', deve corrispondere a metri realmente percorsi.
      expect(avviso.message).toMatch(/[1-9]\d* m di strade a traffico intenso/);
    }
  });
});

describe('qualita’ delle varianti proposte', () => {
  /*
   * Le varianti nascono rendendo piu’ cari i tratti gia’ proposti. Senza un
   * limite la ricerca continua finche’ non finiscono le strade, e le ultime
   * rimaste sono lunghi giri sulla viabilita’ a scorrimento: e’ cosi’ che
   * comparivano proposte da un’ora e mezza lungo la Fogliense mentre esisteva
   * un percorso molto migliore.
   */
  const COPPIE: [string, [number, number], [number, number]][] = [
    // Coppie scelte perche’ senza il filtro producono varianti palesemente
    // peggiori: giri lunghi il doppio, o chilometri di strade a scorrimento.
    ['lungomare → Viale della Vittoria', PLACES.lungomareTrieste, PLACES.vialeVittoria],
    ['lungomare → pista Cardinali', PLACES.lungomareTrieste, PLACES.pistaCardinali],
    ['lungomare → Cattabrighe', PLACES.lungomareTrieste, PLACES.cattabrighe],
    ['lungomare → Villa Fastiggi', PLACES.lungomareTrieste, PLACES.villaFastiggi],
    ['lungomare → Panoramica Ardizio', PLACES.lungomareTrieste, PLACES.panoramicaArdizio],
  ];

  it('nessuna variante allunga il viaggio oltre la soglia dichiarata', () => {
    for (const [nome, origine, destinazione] of COPPIE) {
      const percorsi = router.route({ origin: origine, destination: destinazione });
      const migliore = Math.min(...percorsi.map((r) => r.distanceMeters));
      for (const variante of percorsi.filter((r) => r.isVariant)) {
        expect(
          variante.distanceMeters,
          `${nome}: variante da ${Math.round(variante.distanceMeters)} m contro le ${Math.round(migliore)} m del percorso migliore`,
          // Il limite e’ scritto qui e non preso da ROUTE_VARIANT_MAX_DETOUR:
          // se il test riusasse la costante del filtro, alzarla farebbe
          // passare il test proprio quando il filtro smette di filtrare.
        ).toBeLessThanOrEqual(migliore * 1.45);
      }
    }
  });

  it('nessuna variante compra la propria diversita’ con il traffico', () => {
    /*
     * La misura non viene stimata dai nomi delle vie — un nome copre tutti gli
     * archi omonimi della citta’ e sovrastima — ma letta dall’avviso che il
     * percorso stesso produce, calcolato sugli archi realmente percorsi.
     * Sotto la soglia dell’avviso i metri trafficati sono per definizione
     * meno di BUSY_ROAD_WARNING_METERS.
     */
    const trafficati = (percorso: Route): number => {
      const avviso = percorso.warnings.find((w) => w.type === 'traffico');
      if (!avviso) return 0;
      const trovato = /(\d+) m di strade a traffico intenso/.exec(avviso.message);
      return trovato ? Number(trovato[1]) : 0;
    };

    for (const [nome, origine, destinazione] of COPPIE) {
      const percorsi = router.route({ origin: origine, destination: destinazione });
      const minimo = Math.min(...percorsi.map(trafficati));
      for (const variante of percorsi.filter((r) => r.isVariant)) {
        expect(
          trafficati(variante),
          `${nome}: la variante aggiunge troppa strada trafficata`,
          // Anche qui il limite e’ esplicito, per la stessa ragione.
        ).toBeLessThanOrEqual(minimo + 400);
      }
    }
  });

  it('nessuna alternativa e’ comprata con la Adriatica', () => {
    /*
     * Piazzale della Liberta’ -> Cattabrighe: finche’ le statali erano solo
     * piu’ care, ogni strada diversa da quelle gia’ proposte finiva sulla
     * Adriatica, e il router doveva fermarsi prima di riempire il numero
     * massimo di alternative — restituire meno percorsi era l’unico modo di
     * non restituirne di cattivi.
     *
     * Ora le statali sono vietate a monte: le alternative che restano sono
     * tutte su viabilita’ ordinaria, e riempire l’elenco non e’ piu’ un
     * sintomo. Quel che va verificato non e’ piu’ quante sono, ma che nessuna
     * di loro paghi la propria diversita’ con il traffico.
     */
    const percorsi = router.route({
      origin: PLACES.piazzaleLiberta,
      destination: PLACES.cattabrighe,
    });
    expect(percorsi.length).toBeGreaterThan(0);
    expect(percorsi.length).toBeLessThanOrEqual(MAX_ROUTE_ALTERNATIVES);
    for (const percorso of percorsi) {
      expect(
        percorso.warnings.find((w) => w.type === 'traffico'),
        `${percorso.profileLabel}: ${percorso.warnings.find((w) => w.type === 'traffico')?.message}`,
      ).toBeUndefined();
    }
  });
});
