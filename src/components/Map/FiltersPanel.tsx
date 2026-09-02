/** Pannello "Mostra sulla mappa". */
import { useAppStore, type LayerVisibility } from '../../store/useAppStore';

const ROWS: { key: keyof LayerVisibility; label: string; icon: string }[] = [
  { key: 'linee', label: 'Linee Bicipolitana', icon: '🚲' },
  { key: 'ciclabili', label: 'Altre piste ciclabili (OSM)', icon: '〰️' },
  { key: 'servizi', label: 'Servizi', icon: '🛠️' },
  { key: 'fontanelle', label: 'Fontanelle', icon: '💧' },
  { key: 'parcheggi', label: 'Parcheggi bici', icon: '🅿️' },
  { key: 'officine', label: 'Officine e negozi', icon: '🔧' },
  { key: 'noleggio', label: 'Noleggio', icon: '🔑' },
  { key: 'parchi', label: 'Parchi e aree picnic', icon: '🌳' },
  { key: 'belvedere', label: 'Belvedere', icon: '👁️' },
  { key: 'ostacoli', label: 'Ostacoli', icon: '⚠️' },
];

export function FiltersPanel(): JSX.Element {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);

  return (
    <section className="panel-section">
      <h2 className="panel-title">Mostra sulla mappa</h2>
      <div>
        {ROWS.map((row) => (
          <label key={row.key} className="toggle-row">
            <input
              type="checkbox"
              checked={layers[row.key]}
              onChange={() => toggleLayer(row.key)}
            />
            <span aria-hidden="true">{row.icon}</span>
            <span>{row.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
