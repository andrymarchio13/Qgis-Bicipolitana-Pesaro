/**
 * Schermata principale: scelta di origine e destinazione, calcolo dei
 * percorsi, alternative e avvio della navigazione.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FiltersPanel } from '../components/Map/FiltersPanel';
import { RouteCard } from '../components/Routing/RouteCard';
import { SearchField } from '../components/Search/SearchField';
import { InstructionList } from '../components/Navigation/NavigationScreen';
import { LineBadge, Notice, Spinner } from '../components/UI';
import type { UseLocationResult } from '../hooks/useLocation';
import { connectorSummary } from '../services/routing/instructions';
import { useAppStore, useSelectedRoute } from '../store/useAppStore';
import type { Location } from '../types';
import { formatDistance } from '../utils/geo';

export interface HomePageProps {
  location: UseLocationResult;
  onStartNavigation: () => void;
  /** Richiede al contenitore di aprire (true) o ridurre (false) il pannello. */
  onRequestPanel?: (expanded: boolean) => void;
}

export function HomePage({
  location,
  onStartNavigation,
  onRequestPanel,
}: HomePageProps): JSX.Element {
  const {
    data,
    origin,
    destination,
    routes,
    routingError,
    calculating,
    phase,
    pickingMode,
    preferredLineId,
    setOrigin,
    setDestination,
    swapEndpoints,
    calculateRoutes,
    selectRoute,
    setPickingMode,
    setPreferredLine,
    setHighlightedLine,
  } = useAppStore();
  const selectedRoute = useSelectedRoute();
  const [showInstructions, setShowInstructions] = useState(false);
  const resultsRef = useRef<HTMLElement | null>(null);

  // Raccordi fuori dalla rete coperta dai dati: il riepilogo deve dire quanto
  // sono lunghi e come si percorrono, perche' un collegamento di chilometri si
  // pedala e chiamarlo "a piedi" renderebbe il tempo mostrato incomprensibile.
  const collegamento = selectedRoute ? connectorSummary(selectedRoute) : null;

  /*
   * Appena arrivano i percorsi il pannello si porta sui risultati: su schermo
   * stretto altrimenti resterebbe visibile il modulo di ricerca, con le
   * schede fuori dallo schermo.
   */
  useEffect(() => {
    if (routes.length === 0) return;
    const node = resultsRef.current;
    if (!node) return;

    // Si scorre esplicitamente il pannello e non con scrollIntoView, che
    // trascinerebbe anche la finestra facendo sparire l'intestazione.
    const panel = node.closest('.app__panel') as HTMLElement | null;
    if (!panel) return;

    const timer = window.setTimeout(() => {
      panel.scrollTo({ top: node.offsetTop - panel.offsetTop, behavior: 'smooth' });
    }, 340);
    return () => window.clearTimeout(timer);
  }, [routes]);

  const lines = useMemo(() => data?.linesById ?? new Map(), [data]);

  const applyCurrentPosition = useCallback(
    async (role: 'origin' | 'destination') => {
      const position = await location.locate();
      if (!position) return;
      const value: Location = {
        lng: position.lng,
        lat: position.lat,
        label: 'La mia posizione',
        source: 'gps',
        accuracy: position.accuracy,
      };
      if (role === 'origin') setOrigin(value);
      else setDestination(value);
    },
    [location, setOrigin, setDestination],
  );

  const canCalculate = Boolean(origin && destination) && phase === 'ready';

  return (
    <>
      <section className="panel-section">
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Come vuoi muoverti?</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 14 }}>
          <span className="chip" style={{ background: 'var(--brand-100)', color: 'var(--brand-800)' }}>
            🚲 In bicicletta
          </span>
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          <SearchField
            role="origin"
            label="Da dove parti?"
            placeholder="Scegli il punto di partenza"
            value={origin}
            onChange={setOrigin}
            onUseCurrentPosition={() => void applyCurrentPosition('origin')}
            onPickOnMap={() => setPickingMode('origin')}
            picking={pickingMode === 'origin'}
            locating={location.status === 'requesting'}
            onOpenChange={onRequestPanel}
          />

          <div style={{ display: 'flex', justifyContent: 'center', margin: '-4px 0' }}>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 36, height: 36 }}
              onClick={swapEndpoints}
              aria-label="Inverti partenza e destinazione"
              title="Inverti"
              disabled={!origin && !destination}
            >
              ⇅
            </button>
          </div>

          <SearchField
            role="destination"
            label="Dove vuoi andare?"
            placeholder="Cerca una destinazione"
            value={destination}
            onChange={setDestination}
            onUseCurrentPosition={() => void applyCurrentPosition('destination')}
            onPickOnMap={() => setPickingMode('destination')}
            picking={pickingMode === 'destination'}
            onOpenChange={onRequestPanel}
          />
        </div>

        {pickingMode ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="info" icon="🗺️">
              Tocca un punto sulla mappa per impostare{' '}
              {pickingMode === 'origin' ? 'la partenza' : 'la destinazione'}.{' '}
              <button
                type="button"
                onClick={() => setPickingMode(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', padding: 0 }}
              >
                Annulla
              </button>
            </Notice>
          </div>
        ) : null}

        {location.message ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="warning" icon="📡">
              {location.message}
            </Notice>
          </div>
        ) : null}

        {preferredLineId ? (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>Linea preferita:</span>
            <LineBadge id={preferredLineId} line={lines.get(preferredLineId)} size="sm" />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPreferredLine(null)}>
              Rimuovi
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn--primary btn--block"
          style={{ marginTop: 14 }}
          onClick={() => calculateRoutes()}
          disabled={!canCalculate || calculating}
        >
          {calculating ? 'Calcolo in corso…' : 'VAI'}
        </button>

        {routingError ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="danger" icon="⚠️">
              {routingError}
            </Notice>
          </div>
        ) : null}
      </section>

      {phase === 'loading-data' || phase === 'loading-graph' ? (
        <div className="panel-section">
          <Spinner
            label={
              phase === 'loading-data'
                ? 'Caricamento dei dati della Bicipolitana…'
                : 'Preparazione del motore di calcolo dei percorsi…'
            }
          />
        </div>
      ) : null}

      {routes.length > 0 ? (
        <section className="panel-section" ref={resultsRef}>
          <h2 className="panel-title">Percorsi disponibili</h2>
          <div className="grid-cards">
            {routes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                lines={lines}
                selected={selectedRoute?.id === route.id}
                onSelect={() => selectRoute(route.id)}
                onStart={onStartNavigation}
              />
            ))}
          </div>

          {selectedRoute ? (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn--ghost btn--block btn--sm"
                onClick={() => setShowInstructions((v) => !v)}
                aria-expanded={showInstructions}
              >
                {showInstructions ? 'Nascondi le indicazioni' : `Mostra le indicazioni (${selectedRoute.instructions.length})`}
              </button>

              {showInstructions ? (
                <div style={{ marginTop: 10 }}>
                  <InstructionList route={selectedRoute} lines={lines} />
                </div>
              ) : null}

              {selectedRoute.warnings.length > 0 ? (
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  {selectedRoute.warnings.map((warning, i) => (
                    <Notice key={i} variant={warning.type === 'blocked' ? 'danger' : 'warning'} icon="⚠️">
                      {warning.message}
                    </Notice>
                  ))}
                </div>
              ) : null}

              <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 12 }}>
                Distanza {formatDistance(selectedRoute.distanceMeters)} · di cui{' '}
                {formatDistance(selectedRoute.bicipolitanaMeters)} su Bicipolitana
                {collegamento
                  ? ` e ${formatDistance(collegamento.meters)} ${collegamento.label}${
                      selectedRoute?.walkingRouted
                        ? ' lungo le strade fino alla rete'
                        : ', in linea d’aria fino alla rete'
                    }`
                  : ''}
                . I tempi sono stime calcolate a velocità media costante.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel-section">
        <h2 className="panel-title">Linee della Bicipolitana</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {data?.lines.map((line) => (
            <button
              key={line.id}
              type="button"
              onClick={() => setHighlightedLine(line.id)}
              onMouseEnter={() => setHighlightedLine(line.id)}
              onMouseLeave={() => setHighlightedLine(null)}
              style={{ border: 'none', background: 'none', padding: 0 }}
              aria-label={`Evidenzia la linea ${line.id}`}
            >
              <LineBadge id={line.id} line={line} />
            </button>
          ))}
        </div>
      </section>

      <FiltersPanel />
    </>
  );
}
