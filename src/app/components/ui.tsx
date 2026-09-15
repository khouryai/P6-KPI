import React, { useMemo, useState } from 'react';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'purple' | 'muted';

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Map a domain status string to a semantic tone. One place, so no screen hand-maps. */
export function statusTone(s: string): Tone {
  switch (s) {
    case 'IN BUDGET':
    case 'SET':
    case 'BASELINE':
    case 'TESTS':
    case 'OVERRIDE':
    case 'P6 ACTUAL':
    case 'TEST WINDOW':
      return 'good';
    case 'DEFAULT':
    case 'CURRENT':
    case 'IN PROGRESS':
    case 'P6':
      return 'warn';
    case 'REVIEW':
    case 'NEEDS SHIFTS':
    case 'NO MATCH':
    case 'NONE':
      return 'bad';
    case 'EXCLUDED':
    case 'DELETED':
    case 'CANCELLED':
    case 'NOT STARTED':
      return 'muted';
    default:
      return 'info';
  }
}

export type HeroStat = { label: string; value: React.ReactNode; tone?: 'red' | 'amber' | 'blue' | 'good' | 'muted' };

/**
 * The page header: mono eyebrow, display title, muted subtitle, and either a
 * chip-stat rail or a row of actions on the right.
 */
export function Page({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
  toolbar,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  stats?: HeroStat[];
  actions?: React.ReactNode;
  /** A filter bank. Rendered as its own full-width row so it never squeezes the title. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="page-hero">
        <div className="min-w-0">
          {eyebrow && <div className="ph-eyebrow">{eyebrow}</div>}
          <h1 className="ph-title">{title}</h1>
          {subtitle && <div className="ph-sub">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {stats && stats.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-[7px]">
              {stats.map((s) => (
                <span key={s.label} className={`ph-stat${s.tone ? ` tone-${s.tone}` : ''}`}>
                  <span className="ph-stat-lbl">{s.label}</span>
                  <span className="ph-stat-val">{s.value}</span>
                </span>
              ))}
            </div>
          )}
          {actions && <div className="ph-actions">{actions}</div>}
        </div>
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--surface)] px-7 py-2.5">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-auto px-7 py-6">{children}</div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/** A KPI card: mono label, large tabular number, muted supporting line. */
export function Stat({
  label,
  value,
  sub,
  tone,
  primary,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad';
  primary?: boolean;
}) {
  return (
    <div className={`kpi-card${primary ? ' kpi-primary' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${tone ? ` tone-${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** A card with a display-weight title and optional right-hand meta. */
export function Panel({
  title,
  meta,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || meta) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {typeof title === 'string' ? <h2 className="card-title">{title}</h2> : title}
          {meta && <div className="text-[11.5px] text-[var(--text-muted)]">{meta}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => React.ReactNode;
  num?: boolean;
  width?: string;
};

/** A sortable table. Sorting is by the column's raw value. */
export function SortableTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  maxHeight = 'calc(100vh - 290px)',
  rowClass,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  maxHeight?: string;
  rowClass?: (row: T) => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);
  const toggle = (key: string) => setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return (
    <div className="table-wrap" style={{ maxHeight }}>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`cursor-pointer select-none ${c.num ? 'text-right' : ''}`}
                style={c.width ? { width: c.width } : undefined}
                onClick={() => toggle(c.key)}
              >
                {c.label}
                {sort?.key === c.key && <span className="ml-1 text-[var(--hitachi-red)]">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={rowClass?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(r) : c.value(r) ?? ''}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[var(--text-subtle)]">
                Nothing to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Text input that commits on blur or Enter, so typing does not re-render the whole table on every key. */
export function CellInput({
  value,
  onCommit,
  type = 'text',
  placeholder,
  className = 'cell-input',
  title,
  list,
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
  className?: string;
  title?: string;
  list?: string;
}) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  const shown = editing ? v : value;
  return (
    <input
      className={className}
      type={type}
      step={type === 'number' ? 'any' : undefined}
      value={shown}
      placeholder={placeholder}
      title={title}
      list={list}
      onFocus={() => {
        setV(value);
        setEditing(true);
      }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Select({
  value,
  options,
  onChange,
  className = 'cell-input',
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
