/**
 * Struttura dell'applicazione: intestazione, pannello (o bottom sheet su
 * mobile) e mappa sempre presente, con la navigazione a schermo intero
 * sovrapposta quando attiva.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route as RouterRoute, Routes, useLocation as useRouterLocation } from 'react-router-dom';

import { MapView } from './components/Map/MapView';
import { WeatherBadge } from './components/Weather/WeatherBadge';
import { NavigationScreen } from './components/Navigation/NavigationScreen';
import { Notice } from './components/UI';
import { useBottomSheet } from './hooks/useBottomSheet';
import { useLocation } from './hooks/useLocation';
import { useWakeLock } from './hooks/useWakeLock';
import { useNavigation } from './hooks/useNavigation';
import { AboutPage, PrivacyPage } from './pages/InfoPages';
import { HomePage } from './pages/HomePage';
import { LandingPage } from './pages/LandingPage';
import { LineDetailPage, LinesPage } from './pages/LinesPage';
import { ServicesPage } from './pages/ServicesPage';
import { poiEmoji } from './config/poi';
import { unlockSpeech } from './services/voice';
import { useAppStore, useSelectedRoute } from './store/useAppStore';
import type { LngLat, Poi } from './types';
import { boundsOf } from './utils/geo';

const NAV_ITEMS = [
  { to: '/', label: 'Mappa', end: true },
  { to: '/linee', label: 'Linee', end: false },
  { to: '/servizi', label: 'Servizi', end: false },
  { to: '/info', label: 'Info', end: false },
];

export function App(): JSX.Element {
  const {
    phase,
    error,
    data,
    routes,
    pickingMode,
    init,
    setOrigin,
    setDestination,
    setPickingMode,
    setHighlightedLine,
    selectRoute,
    replaceRoutes,
  } = useAppStore();
  const selectedRoute = useSelectedRoute();
  const router = useAppStore((s) => s.router);

  const location = useLocation();
  const routerLocation = useRouterLocation();

  const [navigating, setNavigating] = useState(false);
  /*
   * Presentazione iniziale. Chi apre un link diretto a una pagina interna —
   * una linea, la privacy — l'ha gia' scelta: mostrargli prima la copertina
   * sarebbe un ostacolo, non un'accoglienza.
   */
  const [entered, setEntered] = useState(() => routerLocation.pathname !== '/');
  // Su schermo stretto il pannello e' un foglio a tre posizioni; su schermo
  // largo resta la colonna fissa e il foglio non entra in gioco.
  const sheet = useBottomSheet('app__panel');
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  const [clusterPois, setClusterPois] = useState<Poi[] | null>(null);
  const activeRouteRef = useRef(selectedRoute);
  activeRouteRef.current = selectedRoute;

  useEffect(() => {
    void init();
  }, [init]);

  // Il tracciamento GPS resta acceso solo durante la navigazione.
  const { startWatching, stopWatching } = location;
  useEffect(() => {
    if (navigating) startWatching();
    else stopWatching();
  }, [navigating, startWatching, stopWatching]);

  // Con la navigazione attiva lo schermo non deve spegnersi da solo.
  useWakeLock(navigating);

  const destination = useAppStore((s) => s.destination);

  /*
   * Il ricalcolo deve partire dal punto in cui l'utente si trova nell'istante
   * in cui scatta, non da quello che era valido quando la funzione e' stata
   * creata: il riferimento tiene sempre l'ultima posizione ricevuta dal GPS.
   */
  const positionRef = useRef(location.position);
  positionRef.current = location.position;

  const handleReroute = useCallback(async () => {
    const current = positionRef.current;
    const route = activeRouteRef.current;
    if (!current || !route || !router || !destination) return null;
    const next = router.reroute(
      [current.lng, current.lat],
      [destination.lng, destination.lat],
      route.profile,
      destination.label,
    );
    // Passa dallo store, cosi' anche il percorso ricalcolato riceve la
    // rifinitura dei tratti a piedi sulle strade reali.
    if (next) replaceRoutes([next], next.id);
    return next;
  }, [router, destination, replaceRoutes]);

  const navigation = useNavigation({
    route: selectedRoute,
    position: location.position,
    active: navigating,
    onReroute: handleReroute,
  });

  /*
   * Quando arrivano i risultati il foglio sale a meta': mostra la prima
   * scheda lasciando visibile buona parte della mappa. Portarlo tutto su
   * coprirebbe proprio il percorso appena calcolato.
   */
  useEffect(() => {
    if (routes.length > 0) sheet.setSnap('half');
  }, [routes, sheet]);

  /*
   * Parte di mappa nascosta dall'interfaccia: il foglio su mobile, la colonna
   * laterale su desktop. Senza questo dato la mappa centrerebbe il percorso
   * dietro al pannello.
   */
  const obscured = useMemo(
    () => (sheet.isSheet ? { bottom: sheet.visibleHeight } : { right: 0 }),
    [sheet.isSheet, sheet.visibleHeight],
  );

  const fitTo = useMemo(() => {
    if (!selectedRoute) return null;
    return boundsOf(selectedRoute.geometry);
  }, [selectedRoute]);

  const handleMapClick = useCallback(
    (point: LngLat) => {
      if (!pickingMode) {
        setSelectedPoi(null);
        return;
      }
      const value = {
        lng: point[0],
        lat: point[1],
        label: `Punto sulla mappa (${point[1].toFixed(5)}, ${point[0].toFixed(5)})`,
        source: 'map' as const,
      };
      if (pickingMode === 'origin') setOrigin(value);
      else setDestination(value);
      setPickingMode(null);
      sheet.setSnap('half');
    },
    [pickingMode, setOrigin, setDestination, setPickingMode, sheet],
  );

  const handlePoiClick = useCallback(
    (poi: Poi) => {
      setSelectedPoi(poi);
      setClusterPois(null);
      sheet.setSnap('half');
    },
    [sheet],
  );

  // Gruppo di punti troppo ravvicinati per separarsi con lo zoom: invece di
  // ingrandire a vuoto se ne mostra l'elenco.
  const handleClusterClick = useCallback(
    (pois: Poi[]) => {
      setClusterPois(pois);
      setSelectedPoi(null);
      sheet.setSnap('half');
    },
    [sheet],
  );

  const handleLineClick = useCallback(
    (lineId: string) => {
      setHighlightedLine(lineId);
    },
    [setHighlightedLine],
  );

  if (!entered) return <LandingPage onEnter={() => setEntered(true)} />;

  if (navigating && selectedRoute) {
    return (
      <NavigationScreen
        route={selectedRoute}
        navigation={navigation}
        position={location.position}
        lines={data?.linesById ?? new Map()}
        gpsMessage={location.message}
        onExit={() => setNavigating(false)}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="header__brand">
          <span className="header__mark" aria-hidden="true">
            🚲
          </span>
          <span className="header__titles">
            <strong>BICIPOLITANA PESARO</strong>
            <span>Il navigatore ciclabile di Pesaro</span>
          </span>
        </NavLink>

        <nav className="header__nav" aria-label="Navigazione principale">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="app__body">
        <div className="app__map">
          <MapView
            route={selectedRoute}
            otherRoutes={routes}
            userPosition={location.position}
            onMapClick={handleMapClick}
            onPoiClick={handlePoiClick}
            onClusterClick={handleClusterClick}
            onLineClick={handleLineClick}
            onRouteSelect={selectRoute}
            fitTo={fitTo}
            obscured={obscured}
          />

          <WeatherBadge />

          <div className="map-controls">
            <button
              type="button"
              className="icon-btn"
              onClick={() => void location.locate()}
              aria-label="Centra sulla mia posizione"
              title="La mia posizione"
            >
              ◎
            </button>
          </div>
        </div>

        <aside {...sheet.panelProps} aria-label="Pannello di controllo">
          <div className="sheet" {...sheet.handleProps}>
            <span className="sheet__handle" />
          </div>

          {phase === 'error' ? (
            <div className="panel-section">
              <Notice variant="danger" icon="⚠️">
                {error ?? 'Errore di caricamento.'}
                <br />
                <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} onClick={() => void init()}>
                  Riprova
                </button>
              </Notice>
            </div>
          ) : null}

          {clusterPois ? (
            <ClusterList
              pois={clusterPois}
              onClose={() => setClusterPois(null)}
              onSelect={(poi) => {
                setSelectedPoi(poi);
                setClusterPois(null);
              }}
            />
          ) : null}

          {selectedPoi ? (
            <PoiDetail
              poi={selectedPoi}
              onClose={() => setSelectedPoi(null)}
              onNavigate={() => {
                setDestination({
                  lng: selectedPoi.lng,
                  lat: selectedPoi.lat,
                  label: selectedPoi.name ?? selectedPoi.categoryLabel,
                  source: 'poi',
                });
                setSelectedPoi(null);
              }}
            />
          ) : null}

          <Routes location={routerLocation}>
            <RouterRoute
              path="/"
              element={
                <HomePage
                  location={location}
                  onRequestPanel={(expanded) => sheet.setSnap(expanded ? 'full' : 'half')}
                  onStartNavigation={() => {
                    if (selectedRoute) {
                      // Dentro il tocco, non dopo: e' l'unico momento in cui
                      // iOS concede il permesso di parlare, e la guida vocale
                      // comincia da un effetto che arriva troppo tardi.
                      unlockSpeech();
                      selectRoute(selectedRoute.id);
                      setNavigating(true);
                    }
                  }}
                />
              }
            />
            <RouterRoute path="/linee" element={<LinesPage />} />
            <RouterRoute path="/linea/:id" element={<LineDetailPage />} />
            <RouterRoute path="/servizi" element={<ServicesPage />} />
            <RouterRoute path="/info" element={<AboutPage />} />
            <RouterRoute path="/privacy" element={<PrivacyPage />} />
            <RouterRoute
              path="*"
              element={
                <div className="panel-section">
                  <Notice variant="info" icon="🧭">
                    Pagina non trovata. Torna alla mappa dal menu in alto.
                  </Notice>
                </div>
              }
            />
          </Routes>

          <div className="attribution">
            © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ·
            Basemap © <a href="https://carto.com/attributions">CARTO</a> · Dati GIS: progetto
            Pesaro2026 · <NavLink to="/privacy">Privacy</NavLink>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ClusterList({
  pois,
  onClose,
  onSelect,
}: {
  pois: Poi[];
  onClose: () => void;
  onSelect: (poi: Poi) => void;
}): JSX.Element {
  return (
    <section className="panel-section" style={{ background: 'var(--brand-50)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, flex: 1 }}>
          {pois.length} punti in questa zona
        </h2>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 32, height: 32 }}
          onClick={onClose}
          aria-label="Chiudi l’elenco"
        >
          ✕
        </button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {pois.map((poi) => (
          <li key={poi.id}>
            <button
              type="button"
              className="list-item"
              style={{ background: 'transparent' }}
              onClick={() => onSelect(poi)}
            >
              <span aria-hidden="true" style={{ fontSize: 20, width: 26, textAlign: 'center' }}>
                {poiEmoji(poi.category)}
              </span>
              <span className="list-item__text">
                <span className="list-item__title">{poi.name ?? poi.categoryLabel}</span>
                <span className="list-item__sub">{poi.categoryLabel}</span>
              </span>
              <span aria-hidden="true" style={{ color: 'var(--ink-400)' }}>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PoiDetail({
  poi,
  onClose,
  onNavigate,
}: {
  poi: Poi;
  onClose: () => void;
  onNavigate: () => void;
}): JSX.Element {
  const entries = Object.entries(poi.tags).filter(
    ([key]) => !['full_id', 'osm_id', 'osm_type'].includes(key),
  );
  return (
    <section className="panel-section" style={{ background: 'var(--brand-50)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 17 }}>
            <span aria-hidden="true">{poiEmoji(poi.category)} </span>
            {poi.name ?? poi.categoryLabel}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink-500)' }}>{poi.categoryLabel}</p>
        </div>
        <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Chiudi">
          ✕
        </button>
      </div>

      {poi.kind === 'ostacolo' ? (
        <p style={{ fontSize: 13, marginTop: 8, color: 'var(--warning)' }}>
          Bicicletta: {poi.bicycleAccessLabel}
        </p>
      ) : null}

      <dl style={{ margin: '10px 0', display: 'grid', gap: 4, fontSize: 13 }}>
        {entries.map(([key, value]) => (
          <div key={key} style={{ display: 'flex', gap: 8 }}>
            <dt style={{ color: 'var(--ink-500)', minWidth: 120 }}>{key}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>

      <button type="button" className="btn btn--primary btn--block btn--sm" onClick={onNavigate}>
        Naviga qui
      </button>
    </section>
  );
}
