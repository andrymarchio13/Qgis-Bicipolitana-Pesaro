/**
 * Grafi sintetici per i test del routing.
 *
 * I test sui dati reali dicono se il router funziona *a Pesaro*; non riescono
 * pero' a isolare un singolo comportamento, perche' su migliaia di archi una
 * differenza fra due percorsi puo' avere molte cause insieme. Questi grafi
 * minimi servono all'opposto: poche decine di metri di rete costruita apposta
 * perche' la risposta giusta sia una sola e verificabile a mano.
 *
 * Le coordinate stanno dentro `PESARO_BOUNDS`, cosi' i grafi restano
 * compatibili con i controlli di area dell'applicazione, ma NON descrivono
 * strade esistenti: sono geometria di prova, non dati del progetto.
 */
import type { EdgeKind, GraphEdge, LngLat, RoutingGraph } from '../../src/types';
import { haversine, lineLength } from '../../src/utils/geo';

/** Velocita' usata per derivare i tempi degli archi sintetici (km/h). */
const VELOCITA_KMH = 15;

export interface ArcoSintetico {
  /** Indice del nodo di partenza in `nodi`. */
  da: number;
  /** Indice del nodo di arrivo in `nodi`. */
  a: number;
  /** 0 = Bicipolitana, 1 = strada, 2 = connettore. Default: 1 (strada). */
  tipo?: EdgeKind;
  /** Id della linea Bicipolitana: da valorizzare quando `tipo` e' 0. */
  linea?: string;
  colore?: string;
  nome?: string;
  /** Punteggio di sicurezza 0..1. Default: 0.5. */
  sicurezza?: number;
  /** 1 = percorribile solo da→a, -1 = solo a→da. */
  sensoUnico?: 1 | -1;
  /** Id degli ostacoli associati all'arco. */
  ostacoli?: string[];
  /** Ostacolo con obbligo di scendere dalla bici. */
  scendere?: boolean;
  /** Transito vietato alle bici. */
  vietato?: boolean;
  /** Vertici intermedi, se l'arco non e' un segmento rettilineo. */
  vertici?: LngLat[];
}

/**
 * Costruisce un `RoutingGraph` completo a partire da nodi e archi dichiarati.
 * Lunghezze e tempi non si scrivono a mano: si derivano dalla geometria, cosi'
 * la fixture non puo' dichiarare numeri incoerenti con cio' che disegna.
 */
export function grafoSintetico(nodi: LngLat[], archi: ArcoSintetico[]): RoutingGraph {
  const edges: GraphEdge[] = archi.map((arco, i) => {
    const g: LngLat[] = [nodi[arco.da], ...(arco.vertici ?? []), nodi[arco.a]];
    const d = lineLength(g);
    const edge: GraphEdge = {
      i,
      a: arco.da,
      b: arco.a,
      d,
      t: (d / 1000 / VELOCITA_KMH) * 3600,
      k: arco.tipo ?? 1,
      s: arco.sicurezza ?? 0.5,
      g,
    };
    if (arco.linea) edge.l = arco.linea;
    if (arco.colore) edge.c = arco.colore;
    if (arco.nome) edge.n = arco.nome;
    if (arco.sensoUnico) edge.ow = arco.sensoUnico;
    if (arco.ostacoli?.length) edge.o = arco.ostacoli;
    if (arco.scendere) edge.dm = 1;
    if (arco.vietato) edge.bk = 1;
    return edge;
  });

  return {
    generatedAt: '2026-01-01T00:00:00Z',
    crs: 'EPSG:4326',
    schema: { note: 'grafo sintetico per i test' },
    parameters: {
      snapToleranceMeters: 25,
      obstacleInfluenceRadiusMeters: 15,
      simplifyToleranceMeters: 1,
      cyclingSpeedKmh: VELOCITA_KMH,
      minEdgeLengthMeters: 1,
      note: 'Valori di prova: stime dichiarate, non misure di campo.',
    },
    nodes: nodi,
    edges,
  };
}

/** Distanza in metri fra due nodi di un grafo sintetico. */
export const distanzaFraNodi = (grafo: RoutingGraph, a: number, b: number): number =>
  haversine(grafo.nodes[a], grafo.nodes[b]);

/** Colori di prova: non sono quelli ufficiali di nessuna linea reale. */
const ROSSO = '#e4002b';
const VERDE = '#00843d';

// ---------------------------------------------------------------------------
// Scenari
// ---------------------------------------------------------------------------

/**
 * Due modi di andare da OVEST a EST:
 *   - la linea 1 della Bicipolitana, che passa da NORD ed e' piu' lunga;
 *   - una strada dritta che passa dal CENTRO, piu' corta ma meno sicura.
 *
 * Serve a separare i profili: `bicipolitana` e `safe` devono accettare il giro
 * piu' lungo, `fast` deve prendere la strada.
 */
export const GRAFO_DUE_ITINERARI = grafoSintetico(
  [
    [12.9, 43.9], // 0 OVEST
    [12.905, 43.903], // 1 NORD (sulla linea 1)
    [12.91, 43.9], // 2 EST
    [12.905, 43.9], // 3 CENTRO (sulla strada)
  ],
  [
    { da: 0, a: 1, tipo: 0, linea: '1', colore: ROSSO, sicurezza: 0.95, nome: 'Linea 1 ovest' },
    { da: 1, a: 2, tipo: 0, linea: '1', colore: ROSSO, sicurezza: 0.95, nome: 'Linea 1 est' },
    { da: 0, a: 3, sicurezza: 0.2, nome: 'Strada di prova ovest' },
    { da: 3, a: 2, sicurezza: 0.2, nome: 'Strada di prova est' },
  ],
);

export const NODI_DUE_ITINERARI = { OVEST: 0, NORD: 1, EST: 2, CENTRO: 3 } as const;

/**
 * Un senso unico da SUD a NORD e un giro largo da EST percorribile nei due
 * versi: verso nord si passa dal senso unico, verso sud per forza dal giro.
 * Verifica che l'adiacenza rispetti il tag `ow`.
 */
export const GRAFO_SENSO_UNICO = grafoSintetico(
  [
    [12.9, 43.9], // 0 SUD
    [12.9, 43.905], // 1 NORD
    [12.906, 43.9025], // 2 EST
  ],
  [
    { da: 0, a: 1, sensoUnico: 1, nome: 'Via a senso unico' },
    { da: 0, a: 2, nome: 'Giro est sud' },
    { da: 2, a: 1, nome: 'Giro est nord' },
  ],
);

export const NODI_SENSO_UNICO = { SUD: 0, NORD: 1, EST: 2 } as const;

/**
 * Due tratti vicini (circa 400 m) ma non collegati fra loro: entrambi gli
 * estremi si agganciano al grafo, eppure nessun percorso ciclabile li unisce.
 * E' il caso in cui il router non deve inventare una strada che non c'e': la
 * risposta e' il cammino diretto, dichiarato per quello che e'.
 */
export const GRAFO_SCONNESSO = grafoSintetico(
  [
    [12.9, 43.9], // 0 tratto A, inizio
    [12.902, 43.9], // 1 tratto A, fine
    [12.907, 43.9], // 2 tratto B, inizio
    [12.909, 43.9], // 3 tratto B, fine
  ],
  [
    { da: 0, a: 1, nome: 'Tratto A' },
    { da: 2, a: 3, nome: 'Tratto B' },
  ],
);

export const NODI_SCONNESSO = { A_INIZIO: 0, A_FINE: 1, B_INIZIO: 2, B_FINE: 3 } as const;

/**
 * Da OVEST a EST si passa per una chicane con obbligo di scendere (arco
 * centrale) oppure per un giro a SUD, piu' lungo e libero. Serve a verificare
 * penalita' per ostacolo, avvisi e id degli ostacoli riportati nel percorso.
 */
export const GRAFO_OSTACOLI = grafoSintetico(
  [
    [12.9, 43.9], // 0 OVEST
    [12.9045, 43.9], // 1 CHICANE
    [12.909, 43.9], // 2 EST
    [12.9045, 43.8975], // 3 SUD
  ],
  [
    { da: 0, a: 1, tipo: 0, linea: '2', colore: VERDE, nome: 'Linea 2 ovest', sicurezza: 0.9 },
    {
      da: 1,
      a: 2,
      tipo: 0,
      linea: '2',
      colore: VERDE,
      nome: 'Linea 2 est',
      ostacoli: ['obs-test-1'],
      scendere: true,
      sicurezza: 0.4,
    },
    { da: 0, a: 3, nome: 'Giro sud ovest', sicurezza: 0.7 },
    { da: 3, a: 2, nome: 'Giro sud est', sicurezza: 0.7 },
  ],
);

export const NODI_OSTACOLI = { OVEST: 0, CHICANE: 1, EST: 2, SUD: 3 } as const;

/**
 * Rete a Y: un tronco comune e due rami serviti da linee diverse. Serve ai
 * test sui cambi di linea e sulla preferenza esplicita ("Usa questa linea").
 */
export const GRAFO_DUE_LINEE = grafoSintetico(
  [
    [12.9, 43.9], // 0 PARTENZA
    [12.904, 43.9], // 1 BIVIO
    [12.908, 43.903], // 2 ARRIVO NORD
    [12.908, 43.897], // 3 ARRIVO SUD
  ],
  [
    { da: 0, a: 1, tipo: 0, linea: '1', colore: ROSSO, nome: 'Tronco comune', sicurezza: 0.9 },
    { da: 1, a: 2, tipo: 0, linea: '1', colore: ROSSO, nome: 'Ramo nord', sicurezza: 0.9 },
    { da: 1, a: 3, tipo: 0, linea: '2', colore: VERDE, nome: 'Ramo sud', sicurezza: 0.9 },
  ],
);

export const NODI_DUE_LINEE = { PARTENZA: 0, BIVIO: 1, ARRIVO_NORD: 2, ARRIVO_SUD: 3 } as const;

/**
 * Una strada lunga e curva senza incroci intermedi, come Via Cerreto nei dati
 * reali: chi si trova a meta' e' su una strada nota, ma i nodi stanno lontano.
 * Serve a verificare che il tratto a piedi segua la curva invece di tagliare
 * dritto attraverso quello che sta in mezzo.
 */
export const GRAFO_STRADA_CURVA = grafoSintetico(
  [
    [12.9, 43.9], // 0 INIZIO
    [12.912, 43.9], // 1 FINE
    [12.912, 43.906], // 2 NORD, collegato alla fine della curva
  ],
  [
    {
      da: 0,
      a: 1,
      nome: 'Strada curva di prova',
      // La strada scende a sud e risale: la linea d'aria taglia la campagna.
      vertici: [
        [12.903, 43.8955],
        [12.906, 43.894],
        [12.909, 43.8955],
      ],
    },
    { da: 1, a: 2, nome: 'Strada nord di prova' },
  ],
);

export const NODI_STRADA_CURVA = { INIZIO: 0, FINE: 1, NORD: 2 } as const;

/** Punto a meta' della curva, a pochi metri dalla strada ma lontano dai nodi. */
export const PUNTO_SULLA_CURVA: LngLat = [12.906, 43.8945];

/**
 * Due modi paralleli di arrivare alla stessa meta: una strada a scorrimento
 * (pericolosa, punteggio basso) che passa a pochi metri dal punto di partenza,
 * e una ciclabile tranquilla un centinaio di metri piu' a nord. Le due si
 * ricongiungono a est.
 *
 * Serve a verificare dove il percorso decide di innestarsi: prendere la strada
 * a scorrimento perche' e' piu' vicina significa far camminare l'utente sul
 * ciglio di una carreggiata veloce, e farcelo poi immettere in bicicletta.
 */
export const GRAFO_INNESTO_PERICOLOSO = grafoSintetico(
  [
    [12.9, 43.9], // 0 ovest della strada a scorrimento
    [12.9, 43.901], // 1 ovest della ciclabile, circa 111 m piu' a nord
    [12.92, 43.9], // 2 est, ricongiungimento
    [12.92, 43.901], // 3 est della ciclabile
  ],
  [
    { da: 0, a: 2, nome: 'Strada a scorrimento di prova', sicurezza: 0.1 },
    { da: 1, a: 3, nome: 'Ciclabile di prova', sicurezza: 1 },
    { da: 3, a: 2, nome: 'Raccordo est di prova', sicurezza: 0.8 },
  ],
);

export const NODI_INNESTO_PERICOLOSO = { OVEST: 0, OVEST_CICLABILE: 1, EST: 2 } as const;

/**
 * Punto di partenza: una quindicina di metri a nord della strada a
 * scorrimento, quasi cento dalla ciclabile. La piu' vicina e' quella che a
 * piedi non si vorrebbe percorrere.
 */
export const PUNTO_FRA_LE_DUE_VIE: LngLat = [12.906, 43.90013];
