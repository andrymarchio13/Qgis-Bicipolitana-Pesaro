/**
 * Cosa dice la voce, e quando.
 *
 * Sta separato dalla sintesi vocale perche' e' la parte che ha una regola da
 * rispettare: una manovra si annuncia prima di doverla fare — mai mentre la si
 * sta facendo — e non si ripete mai due volte lo stesso annuncio.
 *
 * Gli annunci sono tre, come su un navigatore stradale, ma tarati sulla
 * bicicletta:
 *
 *   - molto in anticipo (600 m), solo sui tratti lunghi, per sapere che la
 *     prossima manovra e' ancora lontana;
 *   - in preparazione (300 m), che a 15 km/h e' poco piu' di un minuto: il
 *     tempo di accostare o di spostarsi sul lato giusto;
 *   - al momento (60 m), pochi secondi prima dell'incrocio.
 *
 * Con le soglie di un navigatore per auto il primo annuncio arriverebbe tre
 * incroci prima; con una soglia sola si saprebbe della svolta quando si e' gia'
 * dentro.
 */
import {
  VOICE_CHAIN_METERS,
  VOICE_FAR_METERS,
  VOICE_NOW_METERS,
  VOICE_PREPARE_METERS,
} from '../config';
import type { Route, RouteInstruction } from '../types';
import { spokenTripRecap, type TripSummary } from './tripSummary';
import { spokenDistance } from './voice';

export type AnnouncementKind =
  | 'start'
  | 'far'
  | 'prepare'
  | 'now'
  | 'arrive'
  | 'off-route'
  | 'reroute';

export interface Announcement {
  /** Identifica l'annuncio: serve a non ripeterlo mai due volte. */
  key: string;
  kind: AnnouncementKind;
  text: string;
}

export interface GuidanceInput {
  route: Route | null;
  /** La manovra che sta arrivando. */
  instruction: RouteInstruction | null;
  /**
   * La manovra dopo quella in arrivo. Quando le due sono a pochi metri si
   * dicono insieme: fra l'una e l'altra non ci sarebbe il tempo di pronunciare
   * due annunci separati, e il secondo arriverebbe a manovra gia' fatta.
   */
  nextInstruction?: RouteInstruction | null;
  distanceToManeuver: number;
  remainingMeters: number;
  arrived: boolean;
  offRoute: boolean;
  rerouting: boolean;
  /** true finche' l'annuncio di partenza non e' stato dato. */
  started: boolean;
  /** Il viaggio appena concluso, per il riepilogo detto all'arrivo. */
  summary?: TripSummary | null;
}

/**
 * L'annuncio dovuto in questo istante, o `null` se non c'e' nulla da dire.
 *
 * Chi chiama tiene l'elenco delle chiavi gia' pronunciate e scarta quelle che
 * ha gia' letto: qui non c'e' stato, cosi' la regola resta verificabile.
 */
export function announcementFor(input: GuidanceInput): Announcement | null {
  const { route, instruction, distanceToManeuver, arrived, offRoute, rerouting } = input;
  if (!route) return null;

  /*
   * 1) Arrivo: chiude la navigazione, ha la precedenza su tutto. Il riepilogo
   * viene detto qui perche' e' il momento in cui si smette di guardare la
   * strada: e' l'unico annuncio che puo' permettersi di essere lungo.
   */
  if (arrived) {
    const recap = input.summary ? spokenTripRecap(input.summary) : '';
    const testa = 'Sei arrivato a destinazione.';
    return { key: 'arrive', kind: 'arrive', text: recap ? `${testa} ${recap}` : testa };
  }

  /*
   * 2) Ricalcolo e fuori percorso. Il ricalcolo viene prima: quando parte, e'
   * l'informazione che spiega perche' fra poco le indicazioni cambieranno.
   * Sono legati all'identita' del percorso, quindi dopo un ricalcolo possono
   * essere annunciati di nuovo — e' un viaggio diverso.
   */
  if (rerouting) {
    return { key: `reroute:${route.id}`, kind: 'reroute', text: 'Ricalcolo il percorso.' };
  }
  if (offRoute) {
    return {
      key: `off-route:${route.id}`,
      kind: 'off-route',
      text: 'Sei fuori percorso.',
    };
  }

  // 3) Partenza: la prima indicazione, appena la navigazione si avvia.
  if (!input.started) {
    const first = route.instructions[0];
    const testa = first ? first.text : 'Segui il percorso';
    return {
      key: `start:${route.id}`,
      kind: 'start',
      text: `Si parte. ${testa}. In tutto ${spokenDistance(route.distanceMeters)}.`,
    };
  }

  if (!instruction) return null;

  // 4) La manovra in arrivo, in tre tempi.
  const base = `${instruction.index}:${route.id}`;
  const coda = chainedTail(input);
  const manovra = `${lowerFirst(instruction.text)}${coda}`;

  if (distanceToManeuver <= VOICE_NOW_METERS) {
    // L'arrivo si legge com'e' scritto: "Ora, sei arrivato" direbbe due volte
    // la stessa cosa. Se pero' c'e' una manovra attaccata, la frase serve.
    const testo = instruction.type === 'arrive' && !coda ? instruction.text : `Ora, ${manovra}`;
    return { key: `now:${base}`, kind: 'now', text: `${testo}.` };
  }

  if (distanceToManeuver <= VOICE_PREPARE_METERS) {
    return {
      key: `prepare:${base}`,
      kind: 'prepare',
      text: `Tra ${announcedDistance(distanceToManeuver)}, ${manovra}.`,
    };
  }

  /*
   * L'avviso lungo ha senso solo se il tratto che si sta percorrendo e' lungo
   * abbastanza: dopo una svolta, annunciarne subito un'altra a seicento metri
   * significherebbe parlare sopra l'annuncio appena dato.
   */
  if (
    distanceToManeuver <= VOICE_FAR_METERS &&
    legMeters(route, instruction) >= VOICE_FAR_METERS * 1.5
  ) {
    return {
      key: `far:${base}`,
      kind: 'far',
      text: `Tra ${announcedDistance(distanceToManeuver)}, ${manovra}.`,
    };
  }

  return null;
}

/**
 * La coda «, poi ...» quando la manovra successiva e' a ridosso di questa.
 *
 * Restituisce una stringa vuota se non c'e' nulla da concatenare, cosi' si
 * puo' innestare nel testo senza condizioni.
 */
function chainedTail(input: GuidanceInput): string {
  const { instruction, nextInstruction } = input;
  if (!instruction || !nextInstruction) return '';
  const gap = nextInstruction.offsetMeters - instruction.offsetMeters;
  if (!Number.isFinite(gap) || gap <= 0 || gap > VOICE_CHAIN_METERS) return '';
  /*
   * Sotto i quaranta metri le due manovre sono di fatto la stessa curva: il
   * "subito" dice a chi pedala di non rimettersi in carreggiata fra l'una e
   * l'altra.
   */
  const subito = gap <= 40 ? 'subito ' : '';
  return `, poi ${subito}${lowerFirst(nextInstruction.text)}`;
}

/** Metri fra la manovra precedente e questa: la lunghezza del tratto in corso. */
function legMeters(route: Route, instruction: RouteInstruction): number {
  const previous = route.instructions[instruction.index - 1];
  if (!previous) return instruction.offsetMeters;
  return instruction.offsetMeters - previous.offsetMeters;
}

/**
 * La distanza come la direbbe una persona: arrotondata a cifre tonde.
 *
 * Il GPS dice 287 metri, ma «tra 287 metri» suona come una misura da
 * strumento e nessuno la usa per decidere: si annuncia 300, che e' quello che
 * l'orecchio si aspetta. L'arrotondamento non toglie precisione dove conta —
 * sotto i sessanta metri l'annuncio non ha piu' una distanza, dice «ora».
 */
export function announcedDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return spokenDistance(Math.round(meters / 50) * 50);
  return spokenDistance(meters);
}

/**
 * Minuscola iniziale, per innestare l'istruzione dentro una frase.
 *
 * Solo se la parola non e' un nome proprio: "Tra 200 metri, passa alla Linea
 * 5" va bene, ma abbassare la "L" di "Linea" no. Si guarda percio' la sola
 * prima parola, che nelle istruzioni generate e' sempre un verbo.
 */
function lowerFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
