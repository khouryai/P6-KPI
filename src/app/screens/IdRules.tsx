import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, Panel, Notice, Badge, CellInput, SortableTable, type Column, type HeroStat } from '../components/ui';
import type { IdRule, IdRuleField } from '../../engine/types';
import { matchIdRule, normalisePhaseValue, phaseLabel, locationOf, phaseOf } from '../../engine/parse';
import { href } from '../router';

/** A row of the "what this rule actually catches" preview. */
type Hit = { activityId: string; activityName: string; was: string; now: string };

function newId(): string {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Exceptions to how an Activity ID is read.
 *
 * The ID is parsed positionally: location is the 4th dash-delimited segment, phase
 * the 2nd. That holds until a schedule carries a family that does not follow the
 * convention — and it always eventually does. The alternative to this screen is
 * hard-coding each exception in the parser, which means a code change for every one
 * and no way for the person who found it to see why an activity groups where it
 * does.
 *
 * So the exceptions are data, edited here, and applied over the schedule already
 * loaded rather than at import: a rule added now re-groups the current import on
 * the next render, with nothing re-imported and nothing rewritten on disk.
 */
export function IdRules() {
  const { state, model, actions } = useApp();
  const rules = state.data.idRules;
  const [preview, setPreview] = useState<string | null>(null);

  const update = (fn: (list: IdRule[]) => IdRule[]) => actions.update('idRules', fn);

  const add = (field: IdRuleField) =>
    update((list) => [...list, { id: newId(), match: '', field, value: '' }]);

  const edit = (id: string, patch: Partial<IdRule>) =>
    update((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (r: IdRule) => {
    if (!confirm(`Delete the rule "${r.match || '(blank)'} → ${r.value || '(blank)'}"?\n\nThe activities it was moving go back to what their Activity ID says. Nothing else changes.`)) return;
    update((list) => list.filter((x) => x.id !== r.id));
  };

  /**
   * First match wins, so the order is the rule, not decoration: a specific rule has
   * to be able to sit above a general one.
   */
  const move = (id: string, by: number) =>
    update((list) => {
      const i = list.findIndex((r) => r.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /** Every activity in the current schedule, as the ID alone would read it. */
  const activities = useMemo(
    () => (state.data.current?.activities ?? []).filter((a) => a.rowType === 'ACTIVITY'),
    [state.data.current],
  );

  /**
   * What each rule actually catches, counted against the live schedule.
   *
   * A rule that matches nothing is the common mistake — a typo, or a segment that
   * is not in the ID after all — and it is invisible unless the screen says so.
   * Counted through the same matcher the engine uses, with the rules above this one
   * applied first, so the number is what this rule wins rather than what it would
   * win on its own.
   */
  const hits = useMemo(() => {
    const live = rules.filter((r) => !r.disabled && r.match.trim() !== '' && r.value.trim() !== '');
    const out = new Map<string, Hit[]>();
    for (const r of rules) out.set(r.id, []);
    for (const a of activities) {
      for (const field of ['location', 'phase'] as IdRuleField[]) {
        const won = matchIdRule(a.activityId, field, live);
        if (!won) continue;
        const list = out.get(won.id);
        if (!list) continue;
        list.push({
          activityId: a.activityId,
          activityName: a.activityName,
          was: field === 'location' ? locationOf(a.activityId) || '(none in the ID)' : phaseLabel(phaseOf(a.activityId)) || '(none in the ID)',
          now: field === 'location' ? won.value.trim() : phaseLabel(normalisePhaseValue(won.value)),
        });
      }
    }
    return out;
  }, [rules, activities]);

  const live = rules.filter((r) => !r.disabled && r.match.trim() !== '' && r.value.trim() !== '');
  const moved = model.rows.filter((r) => r.locationFromRule || r.phaseFromRule).length;
  const dead = live.filter((r) => (hits.get(r.id)?.length ?? 0) === 0).length;

  const heroStats: HeroStat[] = [
    { label: 'Rules', value: rules.length, tone: 'muted' },
    { label: 'Activities moved', value: moved, tone: moved > 0 ? 'blue' : 'muted' },
    { label: 'Catching nothing', value: dead, tone: dead > 0 ? 'amber' : 'good' },
  ];

  const columns: Column<IdRule>[] = [
    {
      key: 'order',
      label: '',
      value: (r) => rules.indexOf(r),
      hint: 'First match wins, so a specific rule belongs above a general one.',
      render: (r) => (
        <span className="flex gap-1 text-[11px]">
          <button className="btn-link" title="Move up: earlier rules win" disabled={rules.indexOf(r) === 0} onClick={() => move(r.id, -1)}>↑</button>
          <button className="btn-link" title="Move down" disabled={rules.indexOf(r) === rules.length - 1} onClick={() => move(r.id, 1)}>↓</button>
        </span>
      ),
    },
    {
      key: 'match',
      label: 'If the Activity ID contains',
      locked: true,
      value: (r) => r.match,
      hint: 'Matched anywhere in the ID and ignoring case, which is how the problem gets described out loud: "if there is HTT in it".',
      render: (r) => <CellInput className="cell-input" value={r.match} placeholder="HTT" onCommit={(v) => edit(r.id, { match: v.trim() })} />,
    },
    {
      key: 'field',
      label: 'Then set its',
      value: (r) => r.field,
      render: (r) => (
        <select className="cell-input" value={r.field} onChange={(e) => edit(r.id, { field: e.target.value as IdRuleField })}>
          <option value="location">Location</option>
          <option value="phase">Phase</option>
        </select>
      ),
    },
    {
      key: 'value',
      label: 'To',
      value: (r) => r.value,
      hint: 'A location code, or a phase. A phase can be typed as 1 or as P1 — both mean Phase 1.',
      render: (r) => (
        <span className="flex items-baseline gap-2">
          <CellInput className="cell-input" value={r.value} placeholder={r.field === 'location' ? 'HTT' : 'P1'} onCommit={(v) => edit(r.id, { value: v.trim() })} />
          {r.field === 'phase' && r.value.trim() !== '' && (
            <span className="text-[11px] text-[var(--text-muted)]">{phaseLabel(normalisePhaseValue(r.value))}</span>
          )}
        </span>
      ),
    },
    {
      key: 'hits',
      label: 'Activities',
      value: (r) => hits.get(r.id)?.length ?? 0,
      num: true,
      hint: 'How many activities in the current schedule this rule actually wins, with the rules above it applied first. Zero means it is catching nothing — usually a typo.',
      render: (r) => {
        const n = hits.get(r.id)?.length ?? 0;
        if (r.disabled) return <span className="text-[var(--text-subtle)]">—</span>;
        if (!r.match.trim() || !r.value.trim()) return <span className="text-[var(--text-subtle)]">incomplete</span>;
        return n === 0 ? <Badge tone="warn">nothing</Badge> : <button className="btn-link tabular-nums" onClick={() => setPreview(preview === r.id ? null : r.id)}>{n}</button>;
      },
    },
    {
      key: 'note',
      label: 'Why',
      value: (r) => r.note ?? '',
      hint: 'For whoever reads this list next, including you in six months.',
      render: (r) => <CellInput className="cell-input cell-wide" value={r.note ?? ''} placeholder="—" onCommit={(v) => edit(r.id, { note: v.trim() || undefined })} />,
    },
    {
      key: 'on',
      label: 'On',
      value: (r) => (r.disabled ? 0 : 1),
      render: (r) => (
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px]" title="Turn the rule off without deleting it">
          <input type="checkbox" checked={!r.disabled} onChange={(e) => edit(r.id, { disabled: e.target.checked ? undefined : true })} />
        </label>
      ),
    },
    {
      key: 'act',
      label: '',
      value: () => '',
      hint: '',
      render: (r) => <button className="btn-link danger text-[11px]" onClick={() => remove(r)}>delete</button>,
    },
  ];

  const shown = preview === null ? [] : (hits.get(preview) ?? []);

  return (
    <Page
      eyebrow="Setup"
      title="Activity ID Rules"
      subtitle="The Activity ID normally says where an activity is and which phase it belongs to — location is the 4th dash-delimited segment, phase the 2nd. Where a schedule does not follow that, say so here instead of living with it."
      stats={heroStats}
      actions={
        <>
          <button className="btn" onClick={() => add('location')}>Add a location rule</button>
          <button className="btn" onClick={() => add('phase')}>Add a phase rule</button>
        </>
      }
    >
      {activities.length === 0 && (
        <div className="mb-4">
          <Notice tone="info">No current schedule is imported, so there is nothing to match against yet. Rules can still be written; they apply the moment a schedule lands.</Notice>
        </div>
      )}

      {dead > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {dead} {dead === 1 ? 'rule catches' : 'rules catch'} no activity in the current schedule. Check the text is really in the Activity IDs — a rule that matches
            nothing is silent, and reads exactly like one that is working.
          </Notice>
        </div>
      )}

      <Panel
        title="Rules"
        meta={
          <span>
            Read top to bottom: the <b>first</b> rule that matches an ID decides that field, so put a specific rule above a general one. A rule changes how the schedule
            is grouped everywhere — the dashboard phases, <a className="btn-link" href={href('rollup')}>By Phase &amp; Location</a>, the complexity factor an activity
            prices at, and the export. It never rewrites the import: P6&rsquo;s own Activity ID is kept exactly as it came.
          </span>
        }
        className="mb-4"
      >
        {rules.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[var(--text-subtle)]">
            <div>No rules. Every Activity ID is read by its segments alone.</div>
            <div className="mt-2 text-[12px]">
              Add one when you find a family the parsing gets wrong — for example, <span className="mono">HTT</span> in the ID meaning location{' '}
              <span className="mono">HTT</span>, or <span className="mono">LMA</span> meaning Phase 1.
            </div>
          </div>
        ) : (
          <SortableTable
            tableId="id-rules"
            rows={rules}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort={{ key: 'order', dir: 'asc' }}
            maxHeight="420px"
            rowClass={(r) => (r.disabled ? 'row-muted' : preview === r.id ? 'row-warn' : '')}
          />
        )}
      </Panel>

      {preview !== null && shown.length > 0 && (
        <Panel
          title={`${shown.length} ${shown.length === 1 ? 'activity' : 'activities'} this rule moves`}
          meta={<button className="btn btn-mini" onClick={() => setPreview(null)}>Close ✕</button>}
        >
          <SortableTable
            rows={shown}
            columns={[
              { key: 'id', label: 'Activity ID', value: (h) => h.activityId, render: (h) => <span className="mono">{h.activityId}</span> },
              { key: 'name', label: 'Name', value: (h) => h.activityName, render: (h) => <span className="cell-text" title={h.activityName}>{h.activityName}</span> },
              { key: 'was', label: 'The ID says', value: (h) => h.was, render: (h) => <span className="text-[var(--text-muted)]">{h.was}</span> },
              { key: 'now', label: 'The rule says', value: (h) => h.now, render: (h) => <b>{h.now}</b> },
            ]}
            rowKey={(h) => h.activityId}
            defaultSort={{ key: 'id', dir: 'asc' }}
            maxHeight="360px"
          />
        </Panel>
      )}
    </Page>
  );
}
