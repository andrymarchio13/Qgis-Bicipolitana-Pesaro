/**
 * Foglio scorrevole per lo schermo stretto.
 *
 * Tre posizioni di ancoraggio invece di un semplice aperto/chiuso: con un
 * solo stato il pannello finiva per coprire quasi tutta la mappa appena
 * comparivano i risultati. La posizione intermedia mostra le prime schede
 * lasciando visibile metà mappa, che è il caso d'uso normale.
 *
 * L'altezza visibile viene pubblicata come variabile CSS e restituita in
 * pixel, così la mappa può sapere quanta parte di sé è coperta.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

/** Quota visibile di ciascuna posizione, come frazione dell'altezza utile. */
const SNAP_FRACTION: Record<SheetSnap, number> = {
  peek: 0.24,
  half: 0.52,
  full: 0.88,
};

const MIN_PEEK_PX = 150;
const MAX_SHEET_FRACTION = 0.88;

/** Sopra questa larghezza il pannello è una colonna fissa, non un foglio. */
export const SHEET_BREAKPOINT = 760;

export interface UseBottomSheetResult {
  /** true quando il layout è quello a foglio (schermo stretto). */
  isSheet: boolean;
  snap: SheetSnap;
  setSnap: (snap: SheetSnap) => void;
  /** Altezza visibile del foglio in pixel: 0 nel layout a colonna. */
  visibleHeight: number;
  /** Da applicare all'elemento del pannello. */
  panelProps: {
    className: string;
    style: React.CSSProperties;
  };
  /** Da applicare alla maniglia di trascinamento. */
  handleProps: {
    role: 'button';
    tabIndex: number;
    'aria-label': string;
    'aria-expanded': boolean;
    onPointerDown: (event: React.PointerEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onClick: () => void;
  };
}

export function useBottomSheet(baseClassName: string): UseBottomSheetResult {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; visible: number } | null>(null);

  useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const isSheet = viewport.width <= SHEET_BREAKPOINT;
  const sheetMax = Math.round(viewport.height * MAX_SHEET_FRACTION);

  const heightFor = useCallback(
    (value: SheetSnap): number =>
      Math.max(MIN_PEEK_PX, Math.round(viewport.height * SNAP_FRACTION[value])),
    [viewport.height],
  );

  const visibleHeight = useMemo(() => {
    if (!isSheet) return 0;
    if (dragOffset !== null) return Math.min(sheetMax, Math.max(MIN_PEEK_PX, dragOffset));
    return heightFor(snap);
  }, [isSheet, dragOffset, sheetMax, heightFor, snap]);

  // --- trascinamento ------------------------------------------------------
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!isSheet) return;
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      dragStart.current = { y: event.clientY, visible: heightFor(snap) };
      setDragOffset(heightFor(snap));
    },
    [isSheet, heightFor, snap],
  );

  useEffect(() => {
    if (dragOffset === null) return;

    const onMove = (event: PointerEvent): void => {
      if (!dragStart.current) return;
      // Trascinare verso l'alto aumenta la parte visibile.
      const delta = dragStart.current.y - event.clientY;
      setDragOffset(dragStart.current.visible + delta);
    };

    const onUp = (): void => {
      const current = dragOffset;
      dragStart.current = null;
      setDragOffset(null);
      if (current === null) return;
      // Si aggancia alla posizione più vicina a dove è stato lasciato.
      const candidates: SheetSnap[] = ['peek', 'half', 'full'];
      let best: SheetSnap = 'peek';
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const distance = Math.abs(heightFor(candidate) - current);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      setSnap(best);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragOffset, heightFor]);

  const cycle = useCallback(() => {
    setSnap((current) => (current === 'full' ? 'peek' : current === 'peek' ? 'half' : 'full'));
  }, []);

  const className = [
    baseClassName,
    isSheet ? `${baseClassName}--${snap}` : '',
    dragOffset !== null ? `${baseClassName}--dragging` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    isSheet,
    snap,
    setSnap,
    visibleHeight,
    panelProps: {
      className,
      style: isSheet
        ? ({
            '--sheet-max': `${sheetMax}px`,
            '--sheet-visible': `${visibleHeight}px`,
          } as React.CSSProperties)
        : {},
    },
    handleProps: {
      role: 'button',
      tabIndex: 0,
      'aria-label':
        snap === 'full' ? 'Riduci il pannello' : 'Espandi il pannello',
      'aria-expanded': snap !== 'peek',
      onPointerDown,
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          cycle();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSnap((c) => (c === 'peek' ? 'half' : 'full'));
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSnap((c) => (c === 'full' ? 'half' : 'peek'));
        }
      },
      onClick: cycle,
    },
  };
}
