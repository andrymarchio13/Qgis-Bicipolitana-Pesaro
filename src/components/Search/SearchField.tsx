/**
 * Campo di ricerca di origine o destinazione.
 *
 * Le modalità previste sono tutte disponibili: digitazione con suggerimenti,
 * posizione GPS, scelta di un punto sulla mappa, POI e linee Bicipolitana.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useGeocoding } from '../../hooks/useGeocoding';
import type { GeocodingResult, Location } from '../../types';
import { formatDistance } from '../../utils/geo';
import { Spinner } from '../UI';

export interface SearchFieldProps {
  role: 'origin' | 'destination';
  label: string;
  placeholder: string;
  value: Location | null;
  onChange: (location: Location | null) => void;
  onUseCurrentPosition?: () => void;
  onPickOnMap?: () => void;
  picking?: boolean;
  locating?: boolean;
  /**
   * Chiamata quando il campo si apre o si chiude. Su schermo stretto serve a
   * far salire il foglio: altrimenti l'elenco dei suggerimenti resterebbe
   * fuori dallo schermo.
   */
  onOpenChange?: (open: boolean) => void;
}

const KIND_ICON: Record<GeocodingResult['kind'], string> = {
  poi: '📍',
  linea: '🚲',
  indirizzo: '🏠',
  luogo: '🗺️',
};

export function SearchField({
  role,
  label,
  placeholder,
  value,
  onChange,
  onUseCurrentPosition,
  onPickOnMap,
  picking = false,
  locating = false,
  onOpenChange,
}: SearchFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { query, setQuery, results, loading, error, clear } = useGeocoding();

  const changeOpen = useCallback(
    (next: boolean): void => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const wrapper = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) changeOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [open, changeOpen]);

  const select = (result: GeocodingResult): void => {
    onChange({
      lng: result.lng,
      lat: result.lat,
      label: result.label,
      source: result.kind === 'linea' ? 'line' : result.kind === 'poi' ? 'poi' : 'geocoder',
    });
    clear();
    changeOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex]);
    } else if (event.key === 'Escape') {
      changeOpen(false);
    }
  };

  const listId = `search-results-${role}`;

  return (
    <div ref={wrapper} style={{ position: 'relative' }}>
      {open ? (
        <div className={`field field--active`}>
          <span className={`field__dot field__dot--${role}`} aria-hidden="true" />
          <input
            ref={input}
            type="text"
            value={query}
            placeholder={placeholder}
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={onKeyDown}
          />
          {query ? (
            <button
              type="button"
              className="icon-btn"
              style={{ width: 32, height: 32, border: 'none' }}
              onClick={() => clear()}
              aria-label="Cancella la ricerca"
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="field"
          onClick={() => {
            changeOpen(true);
            window.setTimeout(() => input.current?.focus(), 120);
          }}
        >
          <span className={`field__dot field__dot--${role}`} aria-hidden="true" />
          <span className="field__text">
            <span className="field__label">{label}</span>
            <span className={`field__value${value ? '' : ' field__value--empty'}`}>
              {value?.label ?? placeholder}
            </span>
          </span>
          {value ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Rimuovi ${label.toLowerCase()}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              style={{ color: 'var(--ink-400)', padding: 4 }}
            >
              ✕
            </span>
          ) : null}
        </button>
      )}

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={`Risultati per ${label}`}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 30,
            overflow: 'hidden',
            maxHeight: 340,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)' }}>
            {onUseCurrentPosition ? (
              <button
                type="button"
                className="btn btn--subtle btn--sm"
                onClick={() => {
                  onUseCurrentPosition();
                  changeOpen(false);
                }}
                disabled={locating}
              >
                {locating ? '…' : '📍'} La mia posizione
              </button>
            ) : null}
            {onPickOnMap ? (
              <button
                type="button"
                className={`btn btn--sm ${picking ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => {
                  onPickOnMap();
                  changeOpen(false);
                }}
              >
                🗺️ Scegli sulla mappa
              </button>
            ) : null}
          </div>

          {loading ? <Spinner label="Ricerca in corso…" /> : null}

          {!loading && error ? (
            <p style={{ padding: 14, fontSize: 13, color: 'var(--ink-500)' }}>{error}</p>
          ) : null}

          {results.map((result, index) => (
            <button
              key={result.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className="list-item"
              style={index === activeIndex ? { background: 'var(--brand-50)' } : undefined}
              onClick={() => select(result)}
            >
              <span aria-hidden="true" style={{ fontSize: 18 }}>
                {KIND_ICON[result.kind]}
              </span>
              <span className="list-item__text">
                <span className="list-item__title">{result.label}</span>
                <span className="list-item__sub">
                  {result.sublabel ?? (result.source === 'locale' ? 'Dati del progetto' : 'Pesaro')}
                  {result.distanceMeters !== undefined
                    ? ` · ${formatDistance(result.distanceMeters)}`
                    : ''}
                </span>
              </span>
            </button>
          ))}

          {!loading && !error && results.length === 0 && query.length >= 2 ? (
            <p style={{ padding: 14, fontSize: 13, color: 'var(--ink-500)' }}>
              Nessun risultato. Prova con il nome di una via, di un luogo o di una linea.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
