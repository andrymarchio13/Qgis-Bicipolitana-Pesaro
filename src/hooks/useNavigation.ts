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
import type { NavigationState, Route, RouteInstruction } from '../types';
import { projectOnLine } from '../utils/geo';
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
  const arrived = active && route !== null && remainingMeters <= ARRIVAL_THRESHOLD_METERS;

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
    dismissOffRoute,
  };
}
