/** Servizi, ostacoli e punti di svago, con modalità "Vicino a me". */
import { useMemo, useState } from 'react';

import { Notice, Value } from '../components/UI';
import { poiEmoji } from '../config/poi';
import { useLocation } from '../hooks/useLocation';
import { useAppStore } from '../store/useAppStore';
import type { Poi, PoiKind } from '../types';
import { formatDistance, haversine } from '../utils/geo';

const TABS: { key: PoiKind; label: string; icon: string }[] = [
  { key: 'servizio', label: 'Servizi', icon: '🛠️' },
  { key: 'ostacolo', label: 'Ostacoli', icon: '⚠️' },
  { key: 'svago', label: 'Svago', icon: '🌳' },
];

export function ServicesPage(): JSX.Element {
  const data = useAppStore((s) => s.data);
  const setDestination = useAppStore((s) => s.setDestination);
  const [tab, setTab] = useState<PoiKind>('servizio');
  const [nearMe, setNearMe] = useState(false);
  const location = useLocation();

  const items = useMemo(() => {
    if (!data) return [];
    const source =
      tab === 'servizio' ? data.services : tab === 'ostacolo' ? data.obstacles : data.leisure;

    if (nearMe && location.position) {
      const here: [number, number] = [location.position.lng, location.position.lat];
      return source
        .map((poi) => ({ ...poi, distanceMeters: haversine(here, [poi.lng, poi.lat]) }))
        .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
    }

    return [...source].sort((a, b) =>
      (a.name ?? a.categoryLabel).localeCompare(b.name ?? b.categoryLabel),
    );
  }, [data, tab, nearMe, location.position]);

  if (!data) return <div className="panel-section">Caricamento…</div>;

  return (
    <>
      <section className="panel-section">
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>Servizi e punti di interesse</h1>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`btn btn--sm ${tab === item.key ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setTab(item.key)}
              aria-pressed={tab === item.key}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`btn btn--block btn--sm ${nearMe ? 'btn--primary' : 'btn--ghost'}`}
          onClick={async () => {
            if (!nearMe) {
              const position = await location.locate();
              if (position) setNearMe(true);
            } else {
              setNearMe(false);
            }
          }}
        >
          📍 {nearMe ? 'Ordinamento per distanza attivo' : 'Vicino a me'}
        </button>

        {location.message ? (
          <div style={{ marginTop: 10 }}>
            <Notice variant="warning" icon="📡">
              {location.message}
            </Notice>
          </div>
        ) : null}
      </section>

      <section className="panel-section" style={{ padding: 0 }}>
        {items.map((poi) => (
          <PoiRow
            key={poi.id}
            poi={poi}
            onNavigate={() =>
              setDestination({
                lng: poi.lng,
                lat: poi.lat,
                label: poi.name ?? poi.categoryLabel,
                source: 'poi',
              })
            }
          />
        ))}
        {items.length === 0 ? (
          <p style={{ padding: 16, fontSize: 14, color: 'var(--ink-500)' }}>
            Nessun elemento di questa categoria nei dati del progetto.
          </p>
        ) : null}
      </section>
    </>
  );
}

function PoiRow({ poi, onNavigate }: { poi: Poi; onNavigate: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const tagEntries = Object.entries(poi.tags).filter(
    ([key]) => !['full_id', 'osm_id', 'osm_type'].includes(key),
  );

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        className="list-item"
        style={{ borderBottom: 'none' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span aria-hidden="true" style={{ fontSize: 20, width: 26, textAlign: 'center' }}>
          {poiEmoji(poi.category)}
        </span>
        <span className="list-item__text">
          <span className="list-item__title">{poi.name ?? poi.categoryLabel}</span>
          <span className="list-item__sub">
            {poi.name ? poi.categoryLabel : 'Nome non presente nei dati'}
            {poi.distanceMeters !== undefined ? ` · ${formatDistance(poi.distanceMeters)}` : ''}
          </span>
        </span>
        <span aria-hidden="true" style={{ color: 'var(--ink-400)' }}>
          {open ? '▾' : '›'}
        </span>
      </button>

      {open ? (
        <div style={{ padding: '0 14px 14px' }}>
          {poi.kind === 'ostacolo' ? (
            <div style={{ marginBottom: 10 }}>
              <Notice variant="warning" icon="⚠️">
                <strong>{poi.categoryLabel}</strong>
                <br />
                Bicicletta: <Value>{poi.bicycleAccessLabel}</Value>
                {poi.maxWidthMeters ? (
                  <>
                    <br />
                    Larghezza massima: {poi.maxWidthMeters} m
                  </>
                ) : null}
              </Notice>
            </div>
          ) : null}

          <dl style={{ margin: '0 0 10px', display: 'grid', gap: 4, fontSize: 13 }}>
            {tagEntries.map(([key, value]) => (
              <div key={key} style={{ display: 'flex', gap: 8 }}>
                <dt style={{ color: 'var(--ink-500)', minWidth: 130 }}>{key}</dt>
                <dd style={{ margin: 0 }}>{value}</dd>
              </div>
            ))}
          </dl>

          <button type="button" className="btn btn--primary btn--block btn--sm" onClick={onNavigate}>
            Naviga qui
          </button>
        </div>
      ) : null}
    </div>
  );
}
