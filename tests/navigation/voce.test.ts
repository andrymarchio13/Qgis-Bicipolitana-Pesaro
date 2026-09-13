/** Test della guida vocale: scelta della voce, pronuncia e annunci. */
import { describe, expect, it } from 'vitest';

import { pickItalianVoice, speakableText, spokenDistance } from '../../src/services/voice';
import { announcementFor, type GuidanceInput } from '../../src/services/voiceGuidance';
import type { Route, RouteInstruction } from '../../src/types';

// ---------------------------------------------------------------------------
// Scelta della voce
// ---------------------------------------------------------------------------

const voce = (name: string, lang = 'it-IT', isDefault = false): SpeechSynthesisVoice =>
  ({ name, lang, default: isDefault, localService: true, voiceURI: name }) as SpeechSynthesisVoice;

describe('scelta della voce', () => {
  it('preferisce una voce italiana maschile a una femminile', () => {
    const scelta = pickItalianVoice([
      voce('Microsoft Elsa - Italian (Italy)'),
      voce('Microsoft Cosimo - Italian (Italy)'),
    ]);
    expect(scelta?.voice.name).toContain('Cosimo');
    expect(scelta?.male).toBe(true);
  });

  it('preferisce la voce maschile anche se quella femminile è predefinita', () => {
    const scelta = pickItalianVoice([
      voce('Google italiano', 'it-IT', true),
      voce('Microsoft Diego Online (Natural) - Italian (Italy)'),
    ]);
    expect(scelta?.voice.name).toContain('Diego');
    expect(scelta?.male).toBe(true);
  });

  it('a parità di genere preferisce la voce di qualità superiore', () => {
    const scelta = pickItalianVoice([
      voce('Luca'),
      voce('Luca (Enhanced)'),
    ]);
    expect(scelta?.voice.name).toBe('Luca (Enhanced)');
  });

  it('ignora le voci che non sono italiane', () => {
    const scelta = pickItalianVoice([
      voce('Microsoft David - English (United States)', 'en-US'),
      voce('Google italiano'),
    ]);
    expect(scelta?.voice.lang).toBe('it-IT');
  });

  it('dichiara che la voce non è maschile invece di fingere', () => {
    const scelta = pickItalianVoice([voce('Google italiano')]);
    expect(scelta).not.toBeNull();
    expect(scelta?.male).toBe(false);
  });

  it('non sceglie nulla se non c’è alcuna voce italiana', () => {
    expect(pickItalianVoice([voce('Microsoft David', 'en-US')])).toBeNull();
    expect(pickItalianVoice([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pronuncia
// ---------------------------------------------------------------------------

describe('distanze pronunciate', () => {
  it('scrive per esteso le unità di misura', () => {
    expect(spokenDistance(350)).toBe('350 metri');
    expect(spokenDistance(2000)).toBe('2 chilometri');
  });

  it('dice la virgola dei decimali, che altrimenti verrebbe letta all’inglese', () => {
    expect(spokenDistance(1200)).toBe('1 virgola 2 chilometri');
  });

  it('non annuncia una distanza che è ormai il punto stesso', () => {
    expect(spokenDistance(8)).toBe('pochi metri');
  });

  it('non produce mai NaN o undefined', () => {
    expect(spokenDistance(Number.NaN)).toBe('');
    expect(spokenDistance(-5)).toBe('');
  });
});

describe('testo pronunciabile', () => {
  it('toglie i simboli che verrebbero letti come parole', () => {
    expect(speakableText('Tra 200 m · gira a destra')).toBe('Tra 200 metri gira a destra');
  });

  it('scioglie le abbreviazioni scritte per l’occhio', () => {
    expect(speakableText('Ancora 3 km')).toBe('Ancora 3 chilometri');
  });

  it('toglie le emoji, che nessuna sintesi legge in italiano', () => {
    expect(speakableText('🚲 Parti sulla Linea 1')).toBe('Parti sulla Linea 1');
  });
});

// ---------------------------------------------------------------------------
// Annunci
// ---------------------------------------------------------------------------

const istruzione = (over: Partial<RouteInstruction> = {}): RouteInstruction => ({
  index: 3,
  type: 'right',
  text: 'Gira a destra su Viale Trieste',
  distanceMeters: 0,
  durationSeconds: 0,
  location: [12.9, 43.9],
  lineId: null,
  color: null,
  streetName: 'Viale Trieste',
  offsetMeters: 800,
  ...over,
});

const percorso = (): Route =>
  ({
    id: 'bicipolitana-0',
    distanceMeters: 3200,
    instructions: [istruzione({ index: 0, type: 'start', text: 'Parti sulla Linea 1' }), istruzione()],
  }) as unknown as Route;

const input = (over: Partial<GuidanceInput> = {}): GuidanceInput => ({
  route: percorso(),
  instruction: istruzione(),
  distanceToManeuver: 1000,
  remainingMeters: 2400,
  arrived: false,
  offRoute: false,
  rerouting: false,
  started: true,
  ...over,
});

describe('annunci della navigazione', () => {
  it('non dice nulla quando la manovra è ancora lontana', () => {
    expect(announcementFor(input({ distanceToManeuver: 1000 }))).toBeNull();
  });

  it('annuncia la manovra in anticipo, con la distanza', () => {
    const annuncio = announcementFor(input({ distanceToManeuver: 250 }));
    expect(annuncio?.kind).toBe('prepare');
    expect(annuncio?.text).toBe('Tra 250 metri, gira a destra su Viale Trieste.');
  });

  it('annuncia di nuovo la manovra al momento di farla', () => {
    const annuncio = announcementFor(input({ distanceToManeuver: 40 }));
    expect(annuncio?.kind).toBe('now');
    expect(annuncio?.text).toBe('Ora, gira a destra su Viale Trieste.');
  });

  it('usa chiavi diverse per i due tempi, così l’annuncio non si perde', () => {
    const anticipo = announcementFor(input({ distanceToManeuver: 250 }));
    const adesso = announcementFor(input({ distanceToManeuver: 40 }));
    expect(anticipo?.key).not.toBe(adesso?.key);
  });

  it('dà la stessa chiave alla stessa manovra, così non si ripete', () => {
    const primo = announcementFor(input({ distanceToManeuver: 250 }));
    const secondo = announcementFor(input({ distanceToManeuver: 240 }));
    expect(primo?.key).toBe(secondo?.key);
  });

  it('apre la navigazione con la prima indicazione e la distanza totale', () => {
    const annuncio = announcementFor(input({ started: false }));
    expect(annuncio?.kind).toBe('start');
    expect(annuncio?.text).toBe('Si parte. Parti sulla Linea 1. In tutto 3 virgola 2 chilometri.');
  });

  it('l’arrivo ha la precedenza su qualsiasi altra cosa', () => {
    const annuncio = announcementFor(input({ arrived: true, offRoute: true, distanceToManeuver: 5 }));
    expect(annuncio?.kind).toBe('arrive');
    expect(annuncio?.text).toBe('Sei arrivato a destinazione.');
  });

  it('il ricalcolo viene annunciato prima del fuori percorso', () => {
    const annuncio = announcementFor(input({ offRoute: true, rerouting: true }));
    expect(annuncio?.kind).toBe('reroute');
  });

  it('avvisa quando si esce dal percorso', () => {
    const annuncio = announcementFor(input({ offRoute: true }));
    expect(annuncio?.kind).toBe('off-route');
    expect(annuncio?.text).toBe('Sei fuori percorso.');
  });

  it('dopo un ricalcolo può riannunciare il fuori percorso del nuovo viaggio', () => {
    const primo = announcementFor(input({ offRoute: true }));
    const altro = {
      ...input({ offRoute: true }),
      route: { ...percorso(), id: 'bicipolitana-1' } as Route,
    };
    expect(announcementFor(altro)?.key).not.toBe(primo?.key);
  });

  it('non inventa annunci senza un percorso', () => {
    expect(announcementFor(input({ route: null }))).toBeNull();
  });

  it('legge il testo dell’arrivo così com’è, senza anteporvi «Ora»', () => {
    const annuncio = announcementFor(
      input({ distanceToManeuver: 10, instruction: istruzione({ type: 'arrive', text: 'Sei arrivato: Baia Flaminia' }) }),
    );
    expect(annuncio?.text).toBe('Sei arrivato: Baia Flaminia.');
  });

  it('arrotonda la distanza annunciata a una cifra tonda', () => {
    // Il GPS dice 287 metri, ma nessuno decide su quel numero: si annuncia 300.
    const annuncio = announcementFor(input({ distanceToManeuver: 287 }));
    expect(annuncio?.text).toBe('Tra 300 metri, gira a destra su Viale Trieste.');
  });
});

// ---------------------------------------------------------------------------
// Avviso lungo, sui tratti che lo reggono
// ---------------------------------------------------------------------------

/** Un rettilineo di due chilometri fra la partenza e l'unica svolta. */
const rettilineo = (): Route =>
  ({
    id: 'bicipolitana-far',
    distanceMeters: 2400,
    instructions: [
      istruzione({ index: 0, type: 'start', text: 'Parti sulla Linea 1', offsetMeters: 0 }),
      istruzione({ index: 1, offsetMeters: 2000 }),
    ],
  }) as unknown as Route;

describe('avviso molto in anticipo', () => {
  const lungo = (over: Partial<GuidanceInput> = {}): GuidanceInput =>
    input({
      route: rettilineo(),
      instruction: istruzione({ index: 1, offsetMeters: 2000 }),
      ...over,
    });

  it('annuncia la manovra a seicento metri quando il tratto è lungo', () => {
    const annuncio = announcementFor(lungo({ distanceToManeuver: 550 }));
    expect(annuncio?.kind).toBe('far');
    expect(annuncio?.text).toBe('Tra 550 metri, gira a destra su Viale Trieste.');
  });

  it('tace finché la manovra è oltre l’avviso lungo', () => {
    expect(announcementFor(lungo({ distanceToManeuver: 900 }))).toBeNull();
  });

  it('non lo dà su un tratto corto, dove finirebbe sopra l’annuncio precedente', () => {
    const corto = {
      ...lungo({ distanceToManeuver: 550 }),
      // Manovra a 400 m dalla precedente: a 550 m si sta ancora percorrendo
      // il tratto prima, e l'annuncio arriverebbe due manovre in anticipo.
      instruction: istruzione({ index: 1, offsetMeters: 400 }),
    };
    expect(announcementFor(corto)).toBeNull();
  });

  it('usa chiavi distinte per i tre tempi dello stesso incrocio', () => {
    const chiavi = [550, 250, 30].map(
      (d) => announcementFor(lungo({ distanceToManeuver: d }))?.key,
    );
    expect(new Set(chiavi).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Manovre incatenate
// ---------------------------------------------------------------------------

describe('manovre a ridosso l’una dell’altra', () => {
  const seguente = (offset: number): RouteInstruction =>
    istruzione({ index: 4, type: 'left', text: 'Svolta a sinistra su Via Rossini', offsetMeters: offset });

  it('dice le due manovre in una frase sola quando sono vicine', () => {
    const annuncio = announcementFor(
      input({ distanceToManeuver: 250, nextInstruction: seguente(900) }),
    );
    expect(annuncio?.text).toBe(
      'Tra 250 metri, gira a destra su Viale Trieste, poi svolta a sinistra su Via Rossini.',
    );
  });

  it('avverte che la seconda è subito dopo, quando sono la stessa curva', () => {
    const annuncio = announcementFor(
      input({ distanceToManeuver: 40, nextInstruction: seguente(830) }),
    );
    expect(annuncio?.text).toBe(
      'Ora, gira a destra su Viale Trieste, poi subito svolta a sinistra su Via Rossini.',
    );
  });

  it('non incatena manovre lontane fra loro', () => {
    const annuncio = announcementFor(
      input({ distanceToManeuver: 250, nextInstruction: seguente(1400) }),
    );
    expect(annuncio?.text).toBe('Tra 250 metri, gira a destra su Viale Trieste.');
  });
});
