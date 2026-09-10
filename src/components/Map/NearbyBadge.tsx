/**
 * «Vicino a te» — i servizi più vicini alla posizione GPS.
 *
 * Nasce da una scena precisa: ci si ferma, si ha sete, e la domanda non e'
 * «dove sono le fontanelle di Pesaro» ma «qual e' la piu' vicina e da che
 * parte». La mappa la risposta ce l'ha gia', ma cercarla a occhio fra i
 * simboli mentre si e' fermi al sole e' scomodo.
 *
 * Compare solo con una posizione GPS: senza, non c'e' un «te» rispetto a cui
 * misurare, e il riquadro non avrebbe senso.
 *
 * Le distanze sono in linea d'aria e lo dice: calcolare il percorso fino a
 * ognuna sarebbe piu' preciso e molto piu' lento, e per scegliere fra tre
 * fontanelle la linea d'aria basta. Quel che non si fa e' spacciarla per
 * distanza da pedalare.
 */
import { useMemo, useState } from 'react';

import { POI_EMOJI } from '../../config/poi';
import { useAppStore } from '../../store/useAppStore';
import type { LngLat, Poi, PoiCategory } from '../../types';
import { bearing, formatDistance, haversine } from '../../utils/geo';

export interface NearbyBadgeProps {
  position: LngLat | null;
}

/** Le categorie che si cercano quando si e' gia' in strada. */
const CERCATE: { category: PoiCategory; label: string }[] = [
  { category: 'fontanella', label: 'Acqua' },
  { category: 'officina', label: 'Officina' },
  { category: 'negozio_bici', label: 'Negozio bici' },
  { category: 'parcheggio_bici', label: 'Parcheggio' },
  { category: 'noleggio', label: 'Noleggio' },
];

/** Oltre questa distanza «vicino» non e' piu' vicino. */
const RAGGIO_METERS = 2500;

const ROSA = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Da che parte sta, in una parola. */
function direzione(from: LngLat, to: LngLat): string {
  return ROSA[Math.round((((bearing(from, to) % 360) + 360) % 360) / 45) % 8]!;
}

interface Trovato {
  label: string;
  poi: Poi;
  meters: number;
}

export function NearbyBadge({ position }: NearbyBadgeProps): JSX.Element | null {
  const pois = useAppStore((s) => s.data?.pois);
  const setFocusPoint = useAppStore((s) => s.setFocusPoint);
  const [open, setOpen] = useState(false);

  const trovati = useMemo<Trovato[]>(() => {
    if (!position || !pois) return [];

    const out: Trovato[] = [];
    for (const cercata of CERCATE) {
      let migliore: Trovato | null = null;
      for (const poi of pois) {
        if (poi.category !== cercata.category) continue;
        const meters = haversine(position, [poi.lng, poi.lat]);
        if (meters > RAGGIO_METERS) continue;
        if (!migliore || meters < migliore.meters) {
          migliore = { label: cercata.label, poi, meters };
        }
      }
      if (migliore) out.push(migliore);
    }
    return out.sort((a, b) => a.meters - b.meters);
  }, [pois, position]);

  if (!position || trovati.length === 0) return null;

  const primo = trovati[0]!;

  return (
    <div className={`nearby${open ? ' nearby--open' : ''}`}>
      <button
        type="button"
        className="nearby__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Vicino a te: ${primo.label} a ${formatDistance(primo.meters)}. ${
          open ? 'Nascondi' : 'Mostra'
        } l’elenco`}
      >
        <span aria-hidden="true">{POI_EMOJI[primo.poi.category] ?? '📍'}</span>
        <span className="nearby__lead">
          {primo.label} a {formatDistance(primo.meters)}
        </span>
      </button>

      {open ? (
        <div className="nearby__body">
          <ul className="nearby__list">
            {trovati.map((item) => (
              <li key={item.poi.id}>
                <button
                  type="button"
                  onClick={() => setFocusPoint([item.poi.lng, item.poi.lat])}
                  title="Mostra sulla mappa"
                >
                  <span aria-hidden="true">{POI_EMOJI[item.poi.category] ?? '📍'}</span>
                  <span className="nearby__what">{item.poi.name ?? item.label}</span>
                  <span className="nearby__far">
                    {formatDistance(item.meters)} a {direzione(position, [item.poi.lng, item.poi.lat])}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="nearby__note">
            Distanze in linea d’aria dalla tua posizione, non lunghezze di percorso.
          </p>
        </div>
      ) : null}
    </div>
  );
}
