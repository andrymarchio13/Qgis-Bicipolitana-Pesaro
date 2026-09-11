/** Scheda di un percorso alternativo. */
import { connectorSummary, routeRationale } from '../../services/routing/instructions';
import type { Line, Route } from '../../types';
import { formatDistance, formatDuration } from '../../utils/geo';
import { EstimateChip, LineBadge } from '../UI';
import { DaylightNotice } from '../Weather/DaylightNotice';

export interface RouteCardProps {
  route: Route;
  lines: Map<string, Line>;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
}

export function RouteCard({ route, lines, selected, onSelect, onStart }: RouteCardProps): JSX.Element {
  // Un raccordo di tre chilometri non e' "a piedi": si pedala, e la scheda
  // deve dirlo, altrimenti il tempo mostrato sembra sbagliato.
  const collegamento = connectorSummary(route);

  return (
    <div
      className={`route-card${selected ? ' route-card--selected' : ''}`}
      role="group"
      aria-label={`${route.profileLabel}: ${formatDuration(route.durationSeconds)}, ${formatDistance(route.distanceMeters)}`}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
        aria-pressed={selected}
      >
        <div className="route-card__head">
          <span aria-hidden="true" style={{ fontSize: 18 }}>
            {route.profileIcon}
          </span>
          <span className="route-card__profile">{route.profileLabel}</span>
          <span className="route-card__time">{formatDuration(route.durationSeconds)}</span>
        </div>

        {/*
          Il criterio con cui questo percorso e' stato scelto. Sta subito sotto
          il nome del profilo perche' e' li' che serve: le etichette da sole non
          dicono in cosa un percorso sia "piu' veloce" o "piu' tranquillo".
        */}
        <p className="route-card__why">{routeRationale(route)}</p>

        <div className="route-card__meta">
          <span>{formatDistance(route.distanceMeters)}</span>
          <span aria-hidden="true">·</span>
          <EstimateChip />
          {collegamento ? (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="chip"
                title={
                  route.direct
                    ? route.walkingRouted
                      ? 'Percorso diretto fuori dalla rete, calcolato sulle strade'
                      : 'Percorso diretto fuori dalla rete, indicato in linea d’aria'
                    : route.walkingRouted
                      ? 'Raccordo fra i punti scelti e la rete coperta dai dati, calcolato sulle strade'
                      : 'Raccordo fra i punti scelti e la rete coperta dai dati, indicato in linea d’aria'
                }
              >
                {collegamento.icon} {formatDistance(collegamento.meters)} {collegamento.label}
              </span>
            </>
          ) : null}
        </div>

        {route.linesUsed.length > 0 ? (
          <div className="route-card__lines">
            {route.linesUsed.map((id, index) => (
              <span key={`${id}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {index > 0 ? (
                  <span className="route-card__arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <LineBadge id={id} line={lines.get(id)} size="sm" />
              </span>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-500)', margin: '10px 0' }}>
            {route.direct
              ? 'Nessun tratto sulla rete del progetto: qui la Bicipolitana non arriva.'
              : 'Percorso su viabilità ordinaria, senza tratti di Bicipolitana.'}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div className="bar" style={{ flex: 1 }}>
            <div
              className="bar__fill"
              style={{ width: `${route.bicipolitanaPercentage}%` }}
              role="presentation"
            />
          </div>
          <span style={{ fontSize: 12, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>
            {route.bicipolitanaPercentage}% Bicipolitana
          </span>
        </div>

        {route.warnings.length > 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>
            ⚠️ {route.warnings[0].message}
            {route.warnings.length > 1 ? ` (+${route.warnings.length - 1})` : ''}
          </p>
        ) : null}

        {/*
          Se si arriva dopo il tramonto va detto qui, accanto al tempo che lo
          determina, non in un angolo della mappa: e' un elemento con cui si
          sceglie il percorso, non una curiosita' meteorologica.
        */}
        <DaylightNotice route={route} />
      </button>

      {selected ? (
        <button type="button" className="btn btn--primary btn--block btn--sm" style={{ marginTop: 12 }} onClick={onStart}>
          Avvia navigazione
        </button>
      ) : null}
    </div>
  );
}
