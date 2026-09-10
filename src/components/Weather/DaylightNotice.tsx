/**
 * «Torni con la luce?» — l'avviso sul tramonto nella scheda del percorso.
 *
 * Incrocia tre cose che l'app ha gia': l'ora del tramonto dichiarata dal
 * servizio meteo, il tempo stimato del percorso e il tag `lit` di OSM sugli
 * archi del grafo. Compare solo quando c'e' qualcosa da dire, cioe' quando
 * l'arrivo cade dopo il tramonto: un avviso sempre acceso non lo legge piu'
 * nessuno.
 *
 * Sulla dichiarazione dei dati vale la regola di tutto il progetto, e qui
 * conta parecchio: nel grafo l'illuminazione e' dichiarata su una minoranza
 * dei tratti. Quel che non e' dichiarato NON viene contato come buio — viene
 * detto separatamente, come informazione che manca. Sommare le due cose
 * darebbe un numero spaventoso che nessuno ha misurato.
 */
import { clockTime, darknessOnRoute } from '../../services/daylight';
import { useWeather } from '../../hooks/useWeather';
import type { Route } from '../../types';
import { formatDistance, formatDuration } from '../../utils/geo';

export interface DaylightNoticeProps {
  route: Route;
}

export function DaylightNotice({ route }: DaylightNoticeProps): JSX.Element | null {
  const { report } = useWeather();

  const buio = darknessOnRoute({
    lighting: route.lighting,
    durationSeconds: route.durationSeconds,
    // Si parte adesso: e' l'unica partenza che l'app conosce davvero.
    departure: new Date(),
    sunset: report?.sunset ?? null,
  });

  if (!buio) return null;

  const dichiarati = buio.litMeters + buio.unlitMeters;
  // Un itinerario salvato da una versione precedente non porta i tratti: il
  // tempo al buio resta esatto, la distanza semplicemente non si sa.
  const distanzaNota = buio.darkMeters > 0;

  return (
    <p className="daylight">
      <span aria-hidden="true">🌇</span>{' '}
      <span>
        {buio.startsInDark ? (
          <>
            Il sole è tramontato alle {clockTime(buio.sunset)}: l’intero percorso è al buio
          </>
        ) : (
          <>
            Arrivo stimato alle {clockTime(buio.arrival)}, tramonto alle {clockTime(buio.sunset)}:{' '}
            <strong>
              {formatDuration(buio.darkSeconds)} al buio
              {distanzaNota ? ` (${formatDistance(buio.darkMeters)})` : ''}
            </strong>
          </>
        )}
        {'. '}
        {dichiarati > 0 ? (
          <>
            Di quel tratto, {formatDistance(buio.litMeters)} su strade dichiarate illuminate
            {buio.unlitMeters > 0 ? ` e ${formatDistance(buio.unlitMeters)} dichiarate non illuminate` : ''}.
          </>
        ) : null}
        {buio.unknownMeters > 0 ? (
          <>
            {' '}
            Per {formatDistance(buio.unknownMeters)}
            {dichiarati > 0 ? '' : ' — cioè tutto il tratto —'} i dati OSM non dicono se ci sia
            illuminazione: non vuol dire che sia buio, vuol dire che non è stato rilevato.
          </>
        ) : null}{' '}
        Porta le luci.
      </span>
    </p>
  );
}
