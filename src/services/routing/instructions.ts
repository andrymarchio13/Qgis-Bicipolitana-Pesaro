/**
 * Generazione delle istruzioni di navigazione.
 *
 * Principio: si dichiarano soltanto manovre deducibili dalla geometria del
 * percorso e dagli attributi realmente presenti nei dati. Non esistono nel
 * dataset informazioni su semafori, segnaletica o sensi di marcia nelle
 * rotatorie: quelle manovre non vengono quindi mai annunciate.
 */
import {
  MIN_SEGMENT_LENGTH_METERS,
  SHARP_TURN_ANGLE_DEGREES,
  TURN_ANGLE_THRESHOLD_DEGREES,
} from '../../config';
import type {
  Line,
  LngLat,
  ManeuverType,
  Route,
  RouteInstruction,
  RouteSegment,
  RouteStep,
} from '../../types';
import { angleDelta, bearing, formatDistance } from '../../utils/geo';

const lineLabel = (line: Line | undefined, id: string): string =>
  line?.officialName ? `Linea ${id} — ${line.officialName}` : `Linea ${id}`;

function turnType(delta: number): ManeuverType {
  const abs = Math.abs(delta);
  if (abs < TURN_ANGLE_THRESHOLD_DEGREES) return 'continue';
  if (abs >= 160) return 'uturn';
  if (abs >= SHARP_TURN_ANGLE_DEGREES) return delta > 0 ? 'sharp-right' : 'sharp-left';
  if (abs >= 60) return delta > 0 ? 'right' : 'left';
  return delta > 0 ? 'slight-right' : 'slight-left';
}

const TURN_TEXT: Record<ManeuverType, string> = {
  'walk-start': 'Raggiungi a piedi l’inizio del percorso',
  'walk-end': 'Prosegui a piedi fino alla destinazione',
  start: 'Parti',
  continue: 'Prosegui',
  left: 'Svolta a sinistra',
  'slight-left': 'Mantieni la sinistra',
  right: 'Svolta a destra',
  'slight-right': 'Mantieni la destra',
  'sharp-left': 'Svolta secca a sinistra',
  'sharp-right': 'Svolta secca a destra',
  uturn: 'Inverti la marcia',
  'enter-line': 'Entra sulla linea',
  'change-line': 'Cambia linea',
  'leave-line': 'Esci dalla linea',
  arrive: 'Sei arrivato',
};

/** Icona/freccia associata alla manovra, usata dall'interfaccia. */
export const MANEUVER_ARROW: Record<ManeuverType, string> = {
  'walk-start': '🚶',
  'walk-end': '🚶',
  start: '●',
  continue: '↑',
  left: '←',
  'slight-left': '↖',
  right: '→',
  'slight-right': '↗',
  'sharp-left': '↰',
  'sharp-right': '↱',
  uturn: '↺',
  'enter-line': '⇲',
  'change-line': '⇄',
  'leave-line': '⇱',
  arrive: '🏁',
};

/**
 * Raggruppa i passi elementari in segmenti omogenei per linea.
 * I tratti piu' corti della soglia non generano un cambio di linea nel
 * riepilogo: sono attraversamenti, non percorrenze.
 */
export function buildSegments(
  steps: RouteStep[],
  lines: Map<string, Line>,
  fallbackColor: string,
): RouteSegment[] {
  const raw: RouteSegment[] = [];

  for (const step of steps) {
    const lineId = step.edge.l ?? null;
    const color = step.edge.c ?? (lineId ? fallbackColor : '#64748b');
    const last = raw[raw.length - 1];

    if (last && last.lineId === lineId) {
      last.distanceMeters += step.distanceMeters;
      last.durationSeconds += step.durationSeconds;
      last.coordinates.push(...step.coordinates.slice(1));
      if (step.edge.n && !last.streetNames.includes(step.edge.n)) {
        last.streetNames.push(step.edge.n);
      }
      continue;
    }

    raw.push({
      lineId,
      lineName: lineId ? lineLabel(lines.get(lineId), lineId) : null,
      color,
      kind: lineId ? 'bicipolitana' : 'strada',
      distanceMeters: step.distanceMeters,
      durationSeconds: step.durationSeconds,
      coordinates: [...step.coordinates],
      streetNames: step.edge.n ? [step.edge.n] : [],
    });
  }

  // Fusione dei segmenti troppo brevi nel segmento precedente.
  const merged: RouteSegment[] = [];
  for (const segment of raw) {
    const last = merged[merged.length - 1];
    const tooShort = segment.distanceMeters < MIN_SEGMENT_LENGTH_METERS;
    if (last && tooShort) {
      last.distanceMeters += segment.distanceMeters;
      last.durationSeconds += segment.durationSeconds;
      last.coordinates.push(...segment.coordinates.slice(1));
      for (const name of segment.streetNames) {
        if (!last.streetNames.includes(name)) last.streetNames.push(name);
      }
      continue;
    }
    merged.push(segment);
  }

  // Due segmenti consecutivi sulla stessa linea dopo la fusione vanno uniti.
  const joined = joinSameLine(merged);

  /*
   * Alcune linee corrono affiancate per lunghi tratti: il percorso ottimo può
   * quindi rimbalzare fra A e B più volte, producendo un riepilogo del tipo
   * "7 → 5 → 7 → 5" che è tecnicamente esatto ma illeggibile.
   * Se un segmento è racchiuso fra due tratti della stessa linea ed è più
   * corto del doppio della soglia, viene assorbito da quella linea: cambia
   * solo l'etichetta mostrata, non la geometria percorsa.
   */
  const smoothed: RouteSegment[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const previous = smoothed[smoothed.length - 1];
    const next = joined[i + 1];
    const current = joined[i];

    const sandwiched =
      previous !== undefined &&
      next !== undefined &&
      previous.lineId === next.lineId &&
      previous.lineId !== current.lineId &&
      current.distanceMeters < MIN_SEGMENT_LENGTH_METERS * 2;

    if (sandwiched) {
      previous.distanceMeters += current.distanceMeters;
      previous.durationSeconds += current.durationSeconds;
      previous.coordinates.push(...current.coordinates.slice(1));
      for (const name of current.streetNames) {
        if (!previous.streetNames.includes(name)) previous.streetNames.push(name);
      }
      continue;
    }
    smoothed.push(current);
  }

  return joinSameLine(smoothed);
}

function joinSameLine(segments: RouteSegment[]): RouteSegment[] {
  const out: RouteSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.lineId === segment.lineId) {
      last.distanceMeters += segment.distanceMeters;
      last.durationSeconds += segment.durationSeconds;
      last.coordinates.push(...segment.coordinates.slice(1));
      for (const name of segment.streetNames) {
        if (!last.streetNames.includes(name)) last.streetNames.push(name);
      }
      continue;
    }
    out.push(segment);
  }
  return out;
}

/**
 * Costruisce le istruzioni turn-by-turn a partire dai passi del percorso.
 */
export function buildInstructions(
  steps: RouteStep[],
  segments: RouteSegment[],
  lines: Map<string, Line>,
  destinationLabel: string | null,
): RouteInstruction[] {
  if (steps.length === 0) return [];

  const instructions: RouteInstruction[] = [];
  let offset = 0;

  const firstLine = steps[0].edge.l ?? null;
  const startText = firstLine
    ? `Parti sulla ${lineLabel(lines.get(firstLine), firstLine)}`
    : steps[0].edge.n
      ? `Parti su ${steps[0].edge.n}`
      : 'Parti';

  instructions.push({
    index: 0,
    type: 'start',
    text: startText,
    distanceMeters: 0,
    durationSeconds: 0,
    location: steps[0].coordinates[0],
    lineId: firstLine,
    color: steps[0].edge.c ?? null,
    streetName: steps[0].edge.n ?? null,
    offsetMeters: 0,
  });

  const push = (
    type: ManeuverType,
    text: string,
    step: RouteStep,
    location: LngLat,
    at: number,
  ): void => {
    instructions.push({
      index: instructions.length,
      type,
      text,
      distanceMeters: 0,
      durationSeconds: 0,
      location,
      lineId: step.edge.l ?? null,
      color: step.edge.c ?? null,
      streetName: step.edge.n ?? null,
      offsetMeters: at,
    });
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const next = steps[i + 1];
    offset += step.distanceMeters;
    if (!next) break;

    const currentLine = step.edge.l ?? null;
    const nextLine = next.edge.l ?? null;
    const junction = next.coordinates[0];

    // 1) Cambio di linea Bicipolitana: e' l'informazione piu' utile.
    if (currentLine !== nextLine) {
      const enoughToMatter =
        next.distanceMeters >= MIN_SEGMENT_LENGTH_METERS / 3 ||
        (nextLine !== null && currentLine !== null);

      if (enoughToMatter) {
        if (nextLine && currentLine) {
          push(
            'change-line',
            `Passa alla ${lineLabel(lines.get(nextLine), nextLine)}`,
            next,
            junction,
            offset,
          );
          continue;
        }
        if (nextLine && !currentLine) {
          push(
            'enter-line',
            `Immettiti sulla ${lineLabel(lines.get(nextLine), nextLine)}`,
            next,
            junction,
            offset,
          );
          continue;
        }
        if (!nextLine && currentLine) {
          const via = next.edge.n ? ` su ${next.edge.n}` : '';
          push('leave-line', `Lascia la Linea ${currentLine}${via}`, next, junction, offset);
          continue;
        }
      }
    }

    // 2) Svolta geometrica: calcolata sugli ultimi/primi metri dei due tratti.
    const inBearing = tailBearing(step.coordinates);
    const outBearing = headBearing(next.coordinates);
    if (inBearing === null || outBearing === null) continue;

    const type = turnType(angleDelta(inBearing, outBearing));
    if (type === 'continue') continue;

    const streetChanged = Boolean(next.edge.n) && next.edge.n !== step.edge.n;
    const via = streetChanged ? ` su ${next.edge.n}` : '';
    push(type, `${TURN_TEXT[type]}${via}`, next, junction, offset);
  }

  const lastStep = steps[steps.length - 1];
  const arrivalPoint = lastStep.coordinates[lastStep.coordinates.length - 1];
  instructions.push({
    index: instructions.length,
    type: 'arrive',
    text: destinationLabel ? `Sei arrivato: ${destinationLabel}` : 'Sei arrivato a destinazione',
    distanceMeters: 0,
    durationSeconds: 0,
    location: arrivalPoint,
    lineId: lastStep.edge.l ?? null,
    color: lastStep.edge.c ?? null,
    streetName: lastStep.edge.n ?? null,
    offsetMeters: offset,
  });

  // La distanza di un'istruzione e' quella da percorrere fino alla successiva.
  for (let i = 0; i < instructions.length; i += 1) {
    const current = instructions[i];
    const next = instructions[i + 1];
    current.distanceMeters = next ? next.offsetMeters - current.offsetMeters : 0;
  }

  // Il tempo si ricava proporzionalmente alla distanza del percorso completo.
  const totalDistance = offset;
  const totalDuration = steps.reduce((sum, s) => sum + s.durationSeconds, 0);
  for (const instruction of instructions) {
    instruction.durationSeconds =
      totalDistance > 0 ? (instruction.distanceMeters / totalDistance) * totalDuration : 0;
  }

  // Fusione delle istruzioni troppo ravvicinate (< 15 m): sarebbero illeggibili.
  const compact: RouteInstruction[] = [];
  for (const instruction of instructions) {
    const last = compact[compact.length - 1];
    if (
      last &&
      instruction.type !== 'arrive' &&
      last.type !== 'start' &&
      instruction.offsetMeters - last.offsetMeters < 15
    ) {
      last.distanceMeters += instruction.distanceMeters;
      last.durationSeconds += instruction.durationSeconds;
      continue;
    }
    compact.push({ ...instruction, index: compact.length });
  }

  void segments;
  return compact;
}

/**
 * Simbolo della manovra, con il mezzo giusto per i raccordi fuori rete: un
 * collegamento di chilometri si pedala, e mostrargli accanto un pedone
 * direbbe il contrario di quello che dice il testo.
 */
export const maneuverIcon = (instruction: RouteInstruction): string =>
  instruction.transport === 'bici' ? '🚲' : MANEUVER_ARROW[instruction.type];

/**
 * Testo pronto per la schermata di navigazione.
 *
 * La distanza precede la manovra ma il testo non viene reso minuscolo: i nomi
 * delle vie provengono da OpenStreetMap e vanno mostrati come sono scritti.
 */
export function formatInstruction(instruction: RouteInstruction): string {
  if (instruction.type === 'walk-start' || instruction.type === 'walk-end') {
    return `${instruction.text} · ${formatDistance(instruction.distanceMeters)}`;
  }
  if (instruction.type === 'start' || instruction.type === 'arrive') return instruction.text;
  return `Tra ${formatDistance(instruction.distanceMeters)} · ${instruction.text}`;
}

/**
 * Perche' questo percorso e' piu' veloce, piu' tranquillo o piu' ciclabile
 * degli altri proposti. Una riga sola, mostrata nella scheda del percorso.
 *
 * Senza, "Piu' veloce" e "Piu' tranquillo" restano etichette da prendere per
 * buone. Qui si dice cosa il calcolo ha davvero pesato: il criterio viene dai
 * parametri del profilo, non da misure sul campo, e i numeri di questo
 * percorso (quota su Bicipolitana, cambi di linea, barriere) li mostra gia' la
 * scheda, quindi la frase non li ripete.
 */
export function routeRationale(route: Route): string {
  // I percorsi nati evitando i tratti gia' proposti non seguono un criterio
  // diverso: seguono lo stesso, su strade diverse. Dirlo con l'etichetta del
  // profilo li farebbe sembrare cio' che non sono.
  if (route.isVariant) {
    return 'Un’altra strada per lo stesso viaggio: evita i tratti già proposti sopra.';
  }
  switch (route.profile) {
    case 'fast':
      return 'Pesa solo il tempo stimato: non allunga per restare sulle ciclabili.';
    case 'quiet':
      return 'Predilige ciclabili, parchi e strade a basso traffico, anche allungando un po’.';
    case 'safe':
      return 'Massimo peso a ciclabili e strade protette secondo i dati OSM.';
    default:
      return 'Resta sulle linee ufficiali della Bicipolitana finché conviene.';
  }
}

/**
 * Come si percorrono i raccordi fuori rete di un percorso.
 *
 * Serve all'interfaccia per non chiamare "a piedi" un collegamento di tre
 * chilometri, che si pedala. Restituisce `null` quando il percorso e'
 * interamente sulla rete coperta dai dati.
 */
export function connectorSummary(
  route: Route,
): { meters: number; icon: string; label: string } | null {
  const connectors = route.segments.filter((segment) => segment.kind === 'piedi');
  if (connectors.length === 0) return null;

  const meters = connectors.reduce((sum, segment) => sum + segment.distanceMeters, 0);
  const aPiedi = connectors.some((segment) => (segment.transport ?? 'piedi') === 'piedi');
  const inBici = connectors.some((segment) => segment.transport === 'bici');

  if (aPiedi && inBici) return { meters, icon: '🔗', label: 'di collegamento' };
  if (inBici) return { meters, icon: '🚲', label: 'di collegamento, fuori rete' };
  return { meters, icon: '🚶', label: 'a piedi' };
}

function tailBearing(coords: LngLat[]): number | null {
  if (coords.length < 2) return null;
  const end = coords[coords.length - 1];
  for (let i = coords.length - 2; i >= 0; i -= 1) {
    if (coords[i][0] !== end[0] || coords[i][1] !== end[1]) return bearing(coords[i], end);
  }
  return null;
}

function headBearing(coords: LngLat[]): number | null {
  if (coords.length < 2) return null;
  const start = coords[0];
  for (let i = 1; i < coords.length; i += 1) {
    if (coords[i][0] !== start[0] || coords[i][1] !== start[1]) return bearing(start, coords[i]);
  }
  return null;
}
