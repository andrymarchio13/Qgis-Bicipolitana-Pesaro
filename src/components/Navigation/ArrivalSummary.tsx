/**
 * Schermata di arrivo.
 *
 * Compare da sola quando la destinazione e' raggiunta e chiude il viaggio:
 * prima il fatto — sei arrivato — poi il riepilogo di quel che si e' percorso.
 *
 * I numeri sono di due nature diverse e la schermata lo dice: la distanza e il
 * tempo sono misurati durante la navigazione, mentre la quota di Bicipolitana e
 * le linee vengono dal percorso calcolato. Quando la navigazione non ha coperto
 * l'intero percorso — si e' partiti a meta' strada, o si e' arrivati dopo un
 * ricalcolo — quei secondi dati non vengono mostrati affatto, invece di
 * attribuire al viaggio una composizione che non e' stata verificata.
 */
import { useEffect, useRef, type CSSProperties } from 'react';

import { connectorSummary } from '../../services/routing/instructions';
import { describeDelta, type TripSummary } from '../../services/tripSummary';
import type { Line, Route } from '../../types';
import { formatDistance, formatDuration } from '../../utils/geo';
import { LineBadge } from '../UI';

export interface ArrivalSummaryProps {
  route: Route;
  summary: TripSummary;
  lines: Map<string, Line>;
  /** Nome della destinazione, quando lo si conosce. */
  destinationLabel: string | null;
  onClose: () => void;
}

export function ArrivalSummary({
  route,
  summary,
  lines,
  destinationLabel,
  onClose,
}: ArrivalSummaryProps): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const collegamento = connectorSummary(route);

  /*
   * Il fuoco va sul pulsante che chiude: chi naviga con la tastiera o con un
   * lettore di schermo deve trovarsi sul comando che riporta alla mappa, non
   * in cima a un elenco di numeri.
   */
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Con lo schermo acceso in tasca un tocco casuale chiuderebbe il riepilogo:
  // si esce con il pulsante o con Esc, non toccando lo sfondo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="arrival" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
      <div className="arrival__glow" aria-hidden="true" />

      <div className="arrival__seal" aria-hidden="true">
        <span className="arrival__ring arrival__ring--1" />
        <span className="arrival__ring arrival__ring--2" />
        <span className="arrival__disc">
          <svg viewBox="0 0 52 52" className="arrival__check">
            <circle className="arrival__check-circle" cx="26" cy="26" r="23" />
            <path className="arrival__check-mark" d="M15 27.5 L23 35 L38 19" />
          </svg>
        </span>
      </div>

      <h1 className="arrival__title" id="arrival-title">
        Sei arrivato
      </h1>
      <p className="arrival__place">{destinationLabel ?? 'Destinazione raggiunta'}</p>

      <div className="arrival__stats">
        <Tile
          order={0}
          value={formatDistance(summary.distanceMeters)}
          label={summary.complete ? 'percorsi' : 'percorsi in navigazione'}
        />
        <Tile order={1} value={formatDuration(summary.elapsedSeconds)} label="di viaggio" />
        <Tile
          order={2}
          value={summary.averageSpeedKmh === null ? '—' : `${Math.round(summary.averageSpeedKmh)}`}
          label={summary.averageSpeedKmh === null ? 'media non calcolabile' : 'km/h di media'}
        />
        {summary.complete ? (
          <Tile
            order={3}
            value={`${summary.bicipolitanaPercentage}%`}
            label="su Bicipolitana"
          />
        ) : null}
      </div>

      <div className="arrival__rows">
        {/*
          Il confronto con la stima e' il dato che chi ha appena pedalato cerca
          per primo: quel numero glielo aveva promesso l'app prima di partire.
        */}
        {summary.deltaSeconds !== null ? (
          <p className="arrival__row" style={{ '--i': 4 } as CSSProperties}>
            <span aria-hidden="true">⏱️</span>
            {describeDelta(summary.deltaSeconds, summary.plannedSeconds)}
          </p>
        ) : (
          <p className="arrival__row" style={{ '--i': 4 } as CSSProperties}>
            <span aria-hidden="true">ℹ️</span>
            La navigazione non ha coperto l’intero percorso: il riepilogo
            racconta solo il tratto navigato.
          </p>
        )}

        {summary.maxSpeedKmh !== null ? (
          <p className="arrival__row" style={{ '--i': 5 } as CSSProperties}>
            <span aria-hidden="true">⚡</span>
            Punta massima di {Math.round(summary.maxSpeedKmh)} km/h, misurata dal GPS.
          </p>
        ) : null}

        {summary.complete && collegamento ? (
          <p className="arrival__row" style={{ '--i': 6 } as CSSProperties}>
            <span aria-hidden="true">{collegamento.icon}</span>
            {formatDistance(collegamento.meters)} {collegamento.label}, fuori dalla rete del
            progetto.
          </p>
        ) : null}
      </div>

      {summary.linesUsed.length > 0 ? (
        <div className="arrival__lines" style={{ '--i': 7 } as CSSProperties}>
          <span className="arrival__lines-label">Linee percorse</span>
          <span className="arrival__lines-badges">
            {summary.linesUsed.map((id, index) => (
              <span key={`${id}-${index}`} className="arrival__line">
                {index > 0 ? (
                  <span className="arrival__arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <LineBadge id={id} line={lines.get(id)} size="sm" />
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {summary.complete && route.segments.length > 1 ? (
        <details className="arrival__detail" style={{ '--i': 8 } as CSSProperties}>
          <summary>Tratti del percorso</summary>
          <ul className="arrival__legs">
            {route.segments.map((segment, index) => (
              <li key={index}>
                <span
                  className="arrival__leg-dot"
                  aria-hidden="true"
                  style={{ background: segment.color }}
                />
                <span className="arrival__leg-name">
                  {segment.lineName ?? segment.streetNames[0] ?? 'Viabilità ordinaria'}
                </span>
                <span className="arrival__leg-distance">
                  {formatDistance(segment.distanceMeters)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <button
        type="button"
        ref={closeRef}
        className="btn btn--primary btn--block arrival__close"
        onClick={onClose}
      >
        Torna alla mappa
      </button>

      <p className="arrival__note">
        Distanza e tempo sono misurati durante la navigazione; la composizione
        del percorso viene dai dati del progetto.
      </p>
    </div>
  );
}

function Tile({
  value,
  label,
  order,
}: {
  value: string;
  label: string;
  order: number;
}): JSX.Element {
  return (
    <div className="arrival__tile" style={{ '--i': order } as CSSProperties}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
