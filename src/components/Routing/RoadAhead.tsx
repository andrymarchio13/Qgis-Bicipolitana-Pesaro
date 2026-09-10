/**
 * «Sulla strada» — cosa aspettarsi dal percorso scelto.
 *
 * Tre cose che l'app sa gia' ma non aveva mai messo insieme: dove si trova
 * l'acqua lungo la strada, che fondo si pedala e come si prende il vento.
 * Sono le domande di una gita, non di uno spostamento: nessuna di esse
 * cambia il percorso, tutte cambiano come ci si prepara.
 *
 * Ogni riga compare solo se ha qualcosa da dire, e ogni numero dichiara la
 * sua fonte: i punti vengono dal GeoPackage, il fondo dal tag `surface` di
 * OSM, il vento dalla misura del servizio meteo confrontata con la direzione
 * di marcia.
 */
import { useMemo, useState } from 'react';

import {
  DETOUR_DEFAULT_METERS,
  longestDryStretch,
  poisAlongRoute,
  waterAlongRoute,
} from '../../services/alongRoute';
import { SURFACE_LOOK, roughSurface } from '../../services/surface';
import { windOnRoute, windSummary } from '../../services/wind';
import { useWeather } from '../../hooks/useWeather';
import { useAppStore } from '../../store/useAppStore';
import type { Poi, Route } from '../../types';
import { formatDistance } from '../../utils/geo';

export interface RoadAheadProps {
  route: Route;
}

/** Simbolo di una categoria, coerente con quelli usati sulla mappa. */
const ICONA: Record<string, string> = {
  fontanella: '💧',
  officina: '🔧',
  negozio_bici: '🚲',
  noleggio: '🔑',
  parcheggio_bici: '🅿️',
  belvedere: '👁️',
  parco: '🌳',
  area_picnic: '🧺',
};

const nomePoi = (poi: Poi): string => poi.name ?? poi.categoryLabel;

export function RoadAhead({ route }: RoadAheadProps): JSX.Element | null {
  const pois = useAppStore((s) => s.data?.pois);
  const { report } = useWeather();
  const [openWater, setOpenWater] = useState(false);

  const lungoStrada = useMemo(
    () => (pois ? poisAlongRoute(pois, route.geometry) : []),
    [pois, route.geometry],
  );
  const acqua = useMemo(() => waterAlongRoute(lungoStrada), [lungoStrada]);
  const altri = useMemo(
    () => lungoStrada.filter((item) => item.poi.category !== 'fontanella'),
    [lungoStrada],
  );

  const asciutto = useMemo(
    () => longestDryStretch(acqua, route.distanceMeters),
    [acqua, route.distanceMeters],
  );

  const vento = useMemo(
    () =>
      windOnRoute(
        route.geometry,
        report?.current.windDirection ?? null,
        report?.current.windSpeed ?? null,
      ),
    [route.geometry, report],
  );

  const totale = route.surfaces.reduce((sum, s) => sum + s.meters, 0);
  const scomodo = roughSurface(route.surfaces);

  // Se non c'e' nessuna delle tre cose da dire, il riquadro non compare.
  if (lungoStrada.length === 0 && route.surfaces.length === 0 && !vento) return null;

  return (
    <section className="road-ahead">
      <h3 className="road-ahead__title">Sulla strada</h3>

      {/* --- Acqua ----------------------------------------------------- */}
      {acqua.length > 0 ? (
        <div className="road-ahead__row">
          <button
            type="button"
            className="road-ahead__toggle"
            onClick={() => setOpenWater((v) => !v)}
            aria-expanded={openWater}
          >
            <span aria-hidden="true">💧</span>
            <span>
              <strong>
                {acqua.length} {acqua.length === 1 ? 'fontanella' : 'fontanelle'}
              </strong>{' '}
              lungo il percorso · tratto più lungo senza acqua{' '}
              {formatDistance(asciutto.lengthMeters)}
            </span>
            <span className="road-ahead__chevron" aria-hidden="true">
              {openWater ? '▾' : '▸'}
            </span>
          </button>

          {openWater ? (
            <ol className="road-ahead__list">
              {acqua.map((item) => (
                <li key={item.poi.id}>
                  <span className="road-ahead__km">{formatDistance(item.offsetMeters)}</span>
                  <span>{nomePoi(item.poi)}</span>
                  {item.detourMeters > 25 ? (
                    <span className="road-ahead__detour">
                      +{formatDistance(item.detourMeters)} di deviazione
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : (
        <p className="road-ahead__row road-ahead__muted">
          <span aria-hidden="true">💧</span> Nessuna fontanella nei dati entro{' '}
          {formatDistance(DETOUR_DEFAULT_METERS)} dal percorso: porta la borraccia piena.
        </p>
      )}

      {/* --- Altri servizi e soste ------------------------------------- */}
      {altri.length > 0 ? (
        <p className="road-ahead__row">
          {altri.slice(0, 6).map((item) => (
            <span className="road-ahead__chip" key={item.poi.id} title={nomePoi(item.poi)}>
              <span aria-hidden="true">{ICONA[item.poi.category] ?? '📍'}</span>{' '}
              {formatDistance(item.offsetMeters)}
            </span>
          ))}
          {altri.length > 6 ? (
            <span className="road-ahead__chip">+{altri.length - 6} altri</span>
          ) : null}
        </p>
      ) : null}

      {/* --- Fondo ------------------------------------------------------ */}
      {route.surfaces.length > 0 && totale > 0 ? (
        <div className="road-ahead__row">
          <div className="road-ahead__surface" role="img" aria-label={fondoParlato(route, totale)}>
            {route.surfaces.map((share) => (
              <span
                key={share.family}
                className={`road-ahead__surface-part road-ahead__surface-part--${share.family}`}
                style={{ width: `${(share.meters / totale) * 100}%` }}
                title={`${SURFACE_LOOK[share.family].label}: ${formatDistance(share.meters)}`}
              />
            ))}
          </div>
          <p className="road-ahead__legend">
            {route.surfaces.map((share) => (
              <span key={share.family}>
                <span aria-hidden="true">{SURFACE_LOOK[share.family].icon}</span>{' '}
                {SURFACE_LOOK[share.family].label.toLowerCase()} {formatDistance(share.meters)}
              </span>
            ))}
          </p>
          {scomodo ? (
            <p className="road-ahead__note">
              {SURFACE_LOOK[scomodo.family].icon} {SURFACE_LOOK[scomodo.family].note}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* --- Vento ------------------------------------------------------ */}
      {vento ? (
        <p className="road-ahead__row road-ahead__wind">
          <span aria-hidden="true">{windSummary(vento).icon}</span> {windSummary(vento).text}
        </p>
      ) : null}
    </section>
  );
}

/** La barra del fondo, detta a parole per chi non la vede. */
function fondoParlato(route: Route, totale: number): string {
  const voci = route.surfaces.map(
    (share) =>
      `${SURFACE_LOOK[share.family].label}: ${Math.round((share.meters / totale) * 100)}%`,
  );
  return `Fondo del percorso — ${voci.join(', ')}`;
}
