/**
 * Cosa dice la voce, e quando.
 *
 * Sta separato dalla sintesi vocale perche' e' la parte che ha una regola da
 * rispettare: una manovra si annuncia due volte — una in anticipo, per avere
 * il tempo di spostarsi, e una al momento di farla — e non si ripete mai.
 *
 * Le soglie sono tarate sulla bicicletta, non sull'automobile: a 15 km/h
 * trecento metri sono poco piu' di un minuto, che e' l'anticipo giusto per
 * cambiare corsia o accostare. Con le soglie di un navigatore per auto
 * l'annuncio arriverebbe tre incroci prima.
 */
import { VOICE_NOW_METERS, VOICE_PREPARE_METERS } from '../config';
import type { Route, RouteInstruction } from '../types';
import { spokenDistance } from './voice';

export type AnnouncementKind = 'start' | 'prepare' | 'now' | 'arrive' | 'off-route' | 'reroute';

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
  distanceToManeuver: number;
  remainingMeters: number;
  arrived: boolean;
  offRoute: boolean;
  rerouting: boolean;
  /** true finche' l'annuncio di partenza non e' stato dato. */
  started: boolean;
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

  // 1) Arrivo: chiude la navigazione, ha la precedenza su tutto.
  if (arrived) {
    return { key: 'arrive', kind: 'arrive', text: 'Sei arrivato a destinazione.' };
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

  // 4) La manovra in arrivo, in due tempi.
  const base = `${instruction.index}:${route.id}`;

  if (distanceToManeuver <= VOICE_NOW_METERS) {
    const testo =
      instruction.type === 'arrive'
        ? instruction.text
        : `Ora, ${lowerFirst(instruction.text)}`;
    return { key: `now:${base}`, kind: 'now', text: `${testo}.` };
  }

  if (distanceToManeuver <= VOICE_PREPARE_METERS) {
    return {
      key: `prepare:${base}`,
      kind: 'prepare',
      text: `Tra ${spokenDistance(distanceToManeuver)}, ${lowerFirst(instruction.text)}.`,
    };
  }

  return null;
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
