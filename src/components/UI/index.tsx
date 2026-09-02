/** Componenti di interfaccia riutilizzabili. */
import type { ReactNode } from 'react';

import { NOT_AVAILABLE } from '../../config';
import type { Line } from '../../types';

export function LineBadge({
  line,
  id,
  size = 'md',
}: {
  line?: Line;
  id: string;
  size?: 'sm' | 'md' | 'lg';
}): JSX.Element {
  const color = line?.color ?? '#64748b';
  const className =
    size === 'sm' ? 'line-badge line-badge--sm' : size === 'lg' ? 'line-badge line-badge--lg' : 'line-badge';
  return (
    <span
      className={className}
      style={{ background: color }}
      aria-label={`Linea ${id}`}
      title={line?.officialName ? `Linea ${id} — ${line.officialName}` : `Linea ${id}`}
    >
      {id}
    </span>
  );
}

export function Notice({
  variant = 'info',
  icon,
  children,
}: {
  variant?: 'info' | 'warning' | 'danger';
  icon?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`notice notice--${variant}`} role={variant === 'danger' ? 'alert' : 'status'}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <div>{children}</div>
    </div>
  );
}

/** Valore che può mancare nel dataset: mai "undefined" a schermo. */
export function Value({ children }: { children: ReactNode }): JSX.Element {
  const empty =
    children === null ||
    children === undefined ||
    children === '' ||
    (typeof children === 'number' && !Number.isFinite(children));
  if (empty) return <em style={{ color: 'var(--ink-400)', fontStyle: 'normal' }}>{NOT_AVAILABLE}</em>;
  return <>{children}</>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }): JSX.Element {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

export function Spinner({ label }: { label: string }): JSX.Element {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16, color: 'var(--ink-500)' }}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          border: '2px solid var(--ink-200)',
          borderTopColor: 'var(--brand-600)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          display: 'inline-block',
        }}
      />
      <span style={{ fontSize: 14 }}>{label}</span>
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  );
}

export function EstimateChip(): JSX.Element {
  return (
    <span className="chip chip--estimate" title="I tempi sono stimati a velocità media costante, non misurati">
      stima
    </span>
  );
}
