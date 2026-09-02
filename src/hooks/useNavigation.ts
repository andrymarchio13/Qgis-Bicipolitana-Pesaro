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
    if (!active || !isOffRoute || offRouteSince === null || !onReroute || arrived) return;

    const elapsed = Date.now() - offRouteSince;
    const wait = Math.max(0, REROUTE_DEBOUNCE_MS - elapsed);

    rerouteTimer.current = window.setTimeout(() => {
      setRerouting(true);
      Promise.resolve(onReroute())
        .catch(() => null)
        .finally(() => {
          setRerouting(false);
          setOffRouteSince(null);
        });
    }, wait);

    return () => {
      if (rerouteTimer.current !== null) {
        window.clearTimeout(rerouteTimer.current);
        rerouteTimer.current = null;
      }
    };
  }, [active, isOffRoute, offRouteSince, onReroute, arrived]);

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
