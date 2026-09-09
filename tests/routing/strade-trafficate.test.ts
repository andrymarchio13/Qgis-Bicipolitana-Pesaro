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

import { CYCLING_SPEED_KMH, BUSY_HIGHWAY_CLASSES, ROUTING_PROFILES } from '../../src/config';
import { edgeCost, findPath } from '../../src/services/routing/astar';
import { RoutingGraphIndex } from '../../src/services/routing/graph';
import { BicipolitanaRouter } from '../../src/services/routing/router';
import type { Line, RoutingProfileId } from '../../src/types';
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
      if (BUSY_HIGHWAY_CLASSES.has(passo.edge.hw ?? '')) trafficate += passo.edge.d;
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
