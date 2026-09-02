/** Elenco delle linee e pagina di dettaglio di una singola linea. */
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { LineBadge, Notice, Stat, Value } from '../components/UI';
import { poiEmoji } from '../config/poi';
import { useAppStore } from '../store/useAppStore';
import type { Poi } from '../types';
import { formatDistance, haversine } from '../utils/geo';

export function LinesPage(): JSX.Element {
  const data = useAppStore((s) => s.data);
  const setHighlightedLine = useAppStore((s) => s.setHighlightedLine);

  if (!data) return <div className="panel-section">Caricamento delle linee…</div>;

  const totalKm = data.lines.reduce((sum, l) => sum + l.lengthKm, 0);

  return (
    <>
      <section className="panel-section">
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Linee della Bicipolitana</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>
          {data.lines.length} linee per {totalKm.toFixed(1)} km complessivi, come rilevate nel
          progetto GIS.
        </p>
      </section>

      <section className="panel-section" style={{ padding: 0 }}>
        {data.lines.map((line) => (
          <Link
            key={line.id}
            to={`/linea/${line.id}`}
            className="list-item"
            style={{ textDecoration: 'none', color: 'inherit' }}
            onMouseEnter={() => setHighlightedLine(line.id)}
            onMouseLeave={() => setHighlightedLine(null)}
          >
            <LineBadge id={line.id} line={line} />
            <span className="list-item__text">
              <span className="list-item__title">
                {line.officialName ?? line.name}
              </span>
              <span className="list-item__sub">
                {line.lengthKm} km · {line.segments === 1 ? 'tratto continuo' : `${line.segments} tronconi`}
                {line.colorNeedsConfirmation ? ' · colore da confermare' : ''}
              </span>
            </span>
            <span aria-hidden="true" style={{ color: 'var(--ink-400)' }}>
              ›
            </span>
          </Link>
        ))}
      </section>

      <section className="panel-section">
        <Notice variant="info" icon="ℹ️">
          I nomi ufficiali delle linee non sono presenti nel dataset GIS di partenza: vengono
          mostrati solo se inseriti in <code>data/lines.json</code> a partire da una fonte
          verificabile.
        </Notice>
      </section>
    </>
  );
}

export function LineDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const data = useAppStore((s) => s.data);
  const setPreferredLine = useAppStore((s) => s.setPreferredLine);
  const setHighlightedLine = useAppStore((s) => s.setHighlightedLine);
  const graphIndex = useAppStore((s) => s.graphIndex);

  const line = data?.linesById.get(id);

  // Aprire la pagina di una linea la evidenzia e ci porta sopra la mappa.
  useEffect(() => {
    setHighlightedLine(id);
    return () => setHighlightedLine(null);
  }, [id, setHighlightedLine]);

  /** POI entro 150 m dalla linea: distanza calcolata sulla geometria reale. */
  const nearby = useMemo(() => {
    if (!data || !graphIndex || !line) return { services: [], obstacles: [], leisure: [] };
    const edges = graphIndex.edgesOfLine(id);
    const points = edges.flatMap((e) => e.g);
    if (points.length === 0) return { services: [], obstacles: [], leisure: [] };

    const near = (poi: Poi): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const point of points) {
        const d = haversine(point, [poi.lng, poi.lat]);
        if (d < best) best = d;
      }
      return best;
    };

    const withDistance = (list: Poi[]): Poi[] =>
      list
        .map((poi) => ({ ...poi, distanceMeters: near(poi) }))
        .filter((poi) => (poi.distanceMeters ?? Infinity) <= 150)
        .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));

    return {
      services: withDistance(data.services),
      obstacles: withDistance(data.obstacles),
      leisure: withDistance(data.leisure),
    };
  }, [data, graphIndex, line, id]);

  /** Linee che incrociano quella corrente, dal grafo di routing. */
  const connections = useMemo(() => {
    if (!graphIndex) return [];
    const nodes = new Set<number>();
    for (const edge of graphIndex.edgesOfLine(id)) {
      nodes.add(edge.a);
      nodes.add(edge.b);
    }
    const found = new Set<string>();
    for (const edge of graphIndex.edges) {
      if (!edge.l || edge.l === id) continue;
      if (nodes.has(edge.a) || nodes.has(edge.b)) found.add(edge.l);
    }
    return Array.from(found).sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [graphIndex, id]);

  if (!data) return <div className="panel-section">Caricamento…</div>;

  if (!line) {
    return (
      <section className="panel-section">
        <Notice variant="danger" icon="⚠️">
          La linea richiesta non esiste nei dati del progetto.
        </Notice>
        <Link to="/linee" className="btn btn--ghost btn--block btn--sm" style={{ marginTop: 12 }}>
          Torna all’elenco delle linee
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="panel-section">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/linee')}>
          ← Tutte le linee
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 10px' }}>
          <LineBadge id={line.id} line={line} size="lg" />
          <div>
            <h1 style={{ fontSize: 20 }}>{line.name}</h1>
            <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>
              <Value>{line.officialName}</Value>
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <Stat value={`${line.lengthKm} km`} label="Lunghezza" />
          <Stat value={`${Math.round(line.estimatedMinutes)} min`} label="Percorrenza (stima)" />
        </div>

        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => {
            setPreferredLine(line.id);
            setHighlightedLine(line.id);
            navigate('/');
          }}
        >
          Usa questa linea nel calcolo
        </button>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Caratteristiche</h2>
        <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <dt style={{ color: 'var(--ink-500)', minWidth: 120 }}>Stato</dt>
            <dd style={{ margin: 0 }}>
              {line.status === 'unknown' ? <Value>{null}</Value> : line.status}
            </dd>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <dt style={{ color: 'var(--ink-500)', minWidth: 120 }}>Geometria</dt>
            <dd style={{ margin: 0 }}>
              {line.contiguous ? 'Tratto continuo' : `${line.segments} tronconi separati`}
            </dd>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <dt style={{ color: 'var(--ink-500)', minWidth: 120 }}>Colore</dt>
            <dd style={{ margin: 0 }}>
              <code>{line.color}</code>
              <br />
              <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>{line.colorSource}</span>
            </dd>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <dt style={{ color: 'var(--ink-500)', minWidth: 120 }}>Interscambi</dt>
            <dd style={{ margin: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {connections.length > 0 ? (
                connections.map((other) => (
                  <Link key={other} to={`/linea/${other}`}>
                    <LineBadge id={other} line={data.linesById.get(other)} size="sm" />
                  </Link>
                ))
              ) : (
                <Value>{null}</Value>
              )}
            </dd>
          </div>
        </dl>

        {line.colorNeedsConfirmation ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="warning" icon="🎨">
              Questa linea non ha un colore nella simbologia del progetto QGIS: quello mostrato è
              un colore di ripiego, da confermare con la fonte ufficiale.
            </Notice>
          </div>
        ) : null}

        {line.colorConflictsWith.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="warning" icon="🎨">
              Nel progetto QGIS questa linea condivide il colore con la linea{' '}
              {line.colorConflictsWith.join(', ')}.
            </Notice>
          </div>
        ) : null}
      </section>

      <PoiSection title="Servizi lungo la linea" pois={nearby.services} empty="Nessun servizio rilevato entro 150 m." />
      <PoiSection title="Ostacoli segnalati" pois={nearby.obstacles} empty="Nessun ostacolo rilevato entro 150 m." />
      <PoiSection title="Punti di interesse" pois={nearby.leisure} empty="Nessun punto di svago entro 150 m." />
    </>
  );
}

function PoiSection({ title, pois, empty }: { title: string; pois: Poi[]; empty: string }): JSX.Element {
  return (
    <section className="panel-section">
      <h2 className="panel-title">
        {title} {pois.length > 0 ? `(${pois.length})` : ''}
      </h2>
      {pois.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-500)' }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {pois.slice(0, 12).map((poi) => (
            <li
              key={poi.id}
              style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}
            >
              <span aria-hidden="true" style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                {poiEmoji(poi.category)}
              </span>
              <span style={{ flex: 1, fontSize: 14 }}>
                {poi.name ?? poi.categoryLabel}
                {poi.name ? (
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-500)' }}>
                    {poi.categoryLabel}
                  </span>
                ) : null}
                {poi.bicycleAccessLabel && poi.kind === 'ostacolo' ? (
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--warning)' }}>
                    {poi.bicycleAccessLabel}
                  </span>
                ) : null}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>
                {formatDistance(poi.distanceMeters ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
