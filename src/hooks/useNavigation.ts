/**
 * Logica della navigazione turn-by-turn.
 *
 * Riceve la posizione GPS e il percorso attivo, e mantiene:
 *   - la progressiva percorsa e quella residua;
 *   - l'istruzione corrente;
 *   - lo stato di fuori-percorso e il ricalcolo con debounce.
 *
 * Il ricalcolo NON scatta a ogni variazione del GPS: serve che lo scostamento
 * superi la soglia e che si mantenga per l'intera finestra di debounce.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ARRIVAL_THRESHOLD_METERS,
  REROUTE_COOLDOWN_MS,
  REROUTE_DEBOUNCE_MS,
  REROUTE_DISTANCE_THRESHOLD,
} from '../config';
import type { TripStats } from '../services/tripSummary';
import type { NavigationState, Route, RouteInstruction } from '../types';
import { bearing, projectOnLine } from '../utils/geo';
import type { UserPosition } from './useLocation';

export interface UseNavigationOptions {
  route: Route | null;
  position: UserPosition | null;
  active: boolean;
  /** Ricalcolo: deve restituire il nuovo percorso, o null se non riesce. */
  onReroute?: () => Promise<Route | null> | Route | null;
}

export interface UseNavigationResult extends NavigationState {
  currentInstruction: RouteInstruction | null;
  nextInstruction: RouteInstruction | null;
  /** Distanza dalla manovra corrente, in metri. */
  distanceToManeuver: number;
  /** Posizione agganciata al percorso, da mostrare sulla mappa. */
  snappedPosition: [number, number] | null;
  /**
   * Direzione di marcia in gradi, per orientare il segno della posizione.
   *
   * Viene dal percorso, non dal GPS: la bussola del telefono manca su molti
   * dispositivi e resta a null da fermi, mentre il tratto che si sta
   * percorrendo la direzione ce l'ha sempre. Il dato GPS resta come ripiego
   * per il fuori-percorso, dove il tracciato non dice piu' dove si va.
   */
  courseDegrees: number | null;
  /**
   * Quel che la navigazione ha misurato: da quando e' partita, quanto si e'
   * percorso e a che velocita'. Serve al riepilogo dell'arrivo, che racconta
   * il viaggio fatto e non quello preventivato.
   */
  trip: TripStats;
  dismissOffRoute: () => void;
}

export function useNavigation({
  route,
  position,
  active,
  onReroute,
}: UseNavigationOptions): UseNavigationResult {
  const [rerouting, setRerouting] = useState(false);
  const [offRouteSince, setOffRouteSince] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const rerouteTimer = useRef<number | null>(null);
  const lastRerouteAt = useRef(0);
  /*
   * La funzione di ricalcolo cambia identita' a ogni punto GPS, perche' e'
   * costruita sulla posizione corrente. Tenerla in un riferimento evita che
   * l'effetto qui sotto venga smontato e rimontato dieci volte al minuto:
   * senza questo, l'attesa prima del ricalcolo non arriva mai a scadere e il
   * percorso non si aggiorna mai da solo.
   */
  const rerouteRef = useRef(onReroute);
  rerouteRef.current = onReroute;

  const progress = useMemo(() => {
    if (!route || !position || route.geometry.length < 2) return null;
    return projectOnLine([position.lng, position.lat], route.geometry);
  }, [route, position]);

  const totalDistance = route?.distanceMeters ?? 0;
  const traveled = progress?.offsetMeters ?? 0;
  const remainingMeters = Math.max(0, totalDistance - traveled);
  const remainingSeconds =
    route && totalDistance > 0 ? (remainingMeters / totalDistance) * route.durationSeconds : 0;

  const offRouteMeters = progress?.distanceMeters ?? 0;
  const isOffRoute = active && progress !== null && offRouteMeters > REROUTE_DISTANCE_THRESHOLD;
  const withinArrival = active && route !== null && remainingMeters <= ARRIVAL_THRESHOLD_METERS;
  /*
   * L'arrivo, una volta raggiunto, non si disfa: bastano due punti GPS
   * imprecisi, o un passo indietro per mettere la bici al muro, e il
   * riepilogo sparirebbe da sotto gli occhi di chi lo sta leggendo. Si esce
   * dalla schermata d'arrivo chiudendola, non allontanandosi.
   */
  const [arrivedLatched, setArrivedLatched] = useState(false);
  const arrived = active && (withinArrival || arrivedLatched);

  useEffect(() => {
    if (!active) setArrivedLatched(false);
    else if (withinArrival) setArrivedLatched(true);
  }, [active, withinArrival]);

  /*
   * ---------------------------------------------------------------------
   * Misura del viaggio
   *
   * Il tempo e' quello dell'orologio, non una stima: comprende i semafori e
   * le soste, ed e' l'unico dato del riepilogo che descrive il viaggio vero.
   * La progressiva viene tenuta al suo massimo perche' il GPS la fa oscillare
   * all'indietro di qualche metro, e un viaggio non si accorcia.
   */
  const startedAt = useRef<number | null>(null);
  const maxTraveled = useRef(0);
  const maxSpeed = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  if (active && traveled > maxTraveled.current) maxTraveled.current = traveled;
  if (active && position?.speed != null && Number.isFinite(position.speed)) {
    const kmh = position.speed * 3.6;
    if (maxSpeed.current === null || kmh > maxSpeed.current) maxSpeed.current = kmh;
  }
  /*
   * I massimi stanno in riferimenti, che di per se' non fanno rendere. Qui
   * vengono letti in due valori normali: cosi' il riepilogo si aggiorna a ogni
   * punto GPS — e soprattutto e' fresco nell'istante dell'arrivo, che e' quello
   * in cui viene letto ad alta voce.
   */
  const traveledPeak = maxTraveled.current;
  const speedPeak = maxSpeed.current;

  // Ogni navigazione e' un viaggio a se': i numeri del precedente non devono
  // sopravvivergli.
  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    maxTraveled.current = 0;
    maxSpeed.current = null;
    setElapsedSeconds(0);
  }, [active]);

  useEffect(() => {
    // All'arrivo il cronometro si ferma: da li' in poi il riepilogo e' un
    // numero fisso, non una cifra che continua a salire mentre lo si legge.
    if (!active || arrived) return;
    const timer = window.setInterval(() => {
      if (startedAt.current === null) return;
      setElapsedSeconds((Date.now() - startedAt.current) / 1000);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, arrived]);

  useEffect(() => {
    if (!active || !arrived || startedAt.current === null) return;
    // L'ultimo battito del cronometro puo' essere vecchio di un secondo:
    // l'istante dell'arrivo si legge una volta sola, qui.
    setElapsedSeconds((Date.now() - startedAt.current) / 1000);
  }, [active, arrived]);

  const trip = useMemo<TripStats>(
    () => ({
      startedAt: startedAt.current,
      elapsedSeconds,
      traveledMeters: traveledPeak,
      maxSpeedKmh: speedPeak,
    }),
    [elapsedSeconds, traveledPeak, speedPeak],
  );

  // Individua l'istruzione corrente dalla progressiva percorsa.
  const stepIndex = useMemo(() => {
    if (!route || route.instructions.length === 0) return 0;
    let index = 0;
    for (let i = 0; i < route.instructions.length; i += 1) {
      if (route.instructions[i].offsetMeters <= traveled + 5) index = i;
      else break;
    }
    return index;
  }, [route, traveled]);

  const currentInstruction = route?.instructions[stepIndex] ?? null;
  const nextInstruction = route?.instructions[stepIndex + 1] ?? null;
  const distanceToManeuver = nextInstruction
    ? Math.max(0, nextInstruction.offsetMeters - traveled)
    : Math.max(0, remainingMeters);

  // Gestione del fuori-percorso con debounce.
  useEffect(() => {
    if (!active) {
      setOffRouteSince(null);
      setDismissed(false);
      return;
    }
    if (isOffRoute) {
      setOffRouteSince((since) => since ?? Date.now());
    } else {
      setOffRouteSince(null);
      setDismissed(false);
    }
  }, [active, isOffRoute]);

  useEffect(() => {
    if (rerouteTimer.current !== null) {
      window.clearTimeout(rerouteTimer.current);
      rerouteTimer.current = null;
    }
    if (!active || !isOffRoute || offRouteSince === null || !rerouteRef.current || arrived) return;

    const now = Date.now();
    const elapsed = now - offRouteSince;
    // Due attese si sommano: quella che distingue uno scarto vero da un punto
    // GPS sporco, e quella che impedisce di rilanciare il calcolo di continuo
    // se si resta fuori percorso a lungo.
    const wait = Math.max(
      REROUTE_DEBOUNCE_MS - elapsed,
      REROUTE_COOLDOWN_MS - (now - lastRerouteAt.current),
      0,
    );

    rerouteTimer.current = window.setTimeout(() => {
      const reroute = rerouteRef.current;
      if (!reroute) return;
      lastRerouteAt.current = Date.now();
      setRerouting(true);
      Promise.resolve(reroute())
        .catch(() => null)
        .finally(() => {
          setRerouting(false);
          // Azzerare la finestra fa ripartire il conteggio: se dopo il
          // ricalcolo si e' ancora fuori percorso, si riprova piu' tardi
          // invece di restare fermi su un percorso che non si sta seguendo.
          setOffRouteSince(null);
        });
    }, wait);

    return () => {
      if (rerouteTimer.current !== null) {
        window.clearTimeout(rerouteTimer.current);
        rerouteTimer.current = null;
      }
    };
  }, [active, isOffRoute, offRouteSince, arrived]);

  /*
   * Direzione del tratto su cui si e' agganciati. Se ci si e' allontanati dal
   * percorso quella direzione non descrive piu' il movimento reale: li' vale
   * di piu' la bussola, quando c'e'.
   */
  const courseDegrees = useMemo(() => {
    if (!route || !progress) return position?.heading ?? null;
    if (isOffRoute) return position?.heading ?? null;
    const from = route.geometry[progress.index];
    const to = route.geometry[progress.index + 1];
    if (!from || !to) return position?.heading ?? null;
    return bearing(from, to);
  }, [route, progress, isOffRoute, position?.heading]);

  const dismissOffRoute = useCallback(() => setDismissed(true), []);

  return {
    active,
    route,
    stepIndex,
    traveledMeters: traveled,
    remainingMeters,
    remainingSeconds,
    offRouteMeters,
    offRoute: isOffRoute && !dismissed,
    rerouting,
    arrived,
    currentInstruction,
    nextInstruction,
    distanceToManeuver,
    snappedPosition: progress ? (progress.point as [number, number]) : null,
    courseDegrees,
    trip,
    dismissOffRoute,
  };
}
