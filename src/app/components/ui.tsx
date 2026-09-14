import React, { useMemo, useState } from 'react';

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'purple'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    slate: 'bg-slate-200 text-slate-700',
    blue: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
  }[tone];
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function statusTone(s: string): 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'purple' {
  switch (s) {
    case 'IN BUDGET':
    case 'SET':
    case 'BASELINE':
    case 'TESTS':
    case 'OVERRIDE':
    case 'P6 ACTUAL':
    case 'TEST WINDOW':
      return 'green';
    case 'DEFAULT':
    case 'CURRENT':
    case 'IN PROGRESS':
    case 'P6':
      return 'amber';
    case 'REVIEW':
    case 'NEEDS SHIFTS':
    case 'NO MATCH':
    case 'NONE':
      return 'red';
    case 'EXCLUDED':
    case 'DELETED':
    case 'CANCELLED':
    case 'NOT STARTED':
      return 'slate';
    default:
      return 'blue';
  }
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <div className="mt-0.5 text-[12px] text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  const cls = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-red-300 bg-red-50 text-red-900',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  }[tone];
  return <div className={`rounded border px-3 py-2 text-[12px] ${cls}`}>{children}</div>;
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
export function SortableTable<T>({ rows, columns, rowKey, defaultSort, maxHeight = 'calc(100vh - 260px)', rowClass }: {
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
    <div className="overflow-auto rounded border border-slate-200 bg-white" style={{ maxHeight }}>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`cursor-pointer select-none ${c.num ? 'text-right' : ''}`} style={c.width ? { width: c.width } : undefined} onClick={() => toggle(c.key)}>
                {c.label}
                {sort?.key === c.key && <span className="ml-1 text-slate-400">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
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
              <td colSpan={columns.length} className="py-6 text-center text-slate-400">
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
export function CellInput({ value, onCommit, type = 'text', placeholder, className = 'cell-input', title, list }: {
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

export function Select({ value, options, onChange, className = 'cell-input' }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; className?: string }) {
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

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="card">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div>}
    </div>
  );
}
