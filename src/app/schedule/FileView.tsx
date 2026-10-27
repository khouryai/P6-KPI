/**
 * What is in the file: the project's own dates and settings, the calendars with
 * their working weeks and holidays, the codes and fields defined, and every table
 * P6 wrote. The "is this the export I meant to send?" page.
 */
import { holidaysBetween, weekHours } from '../../engine/xerCalendar';
import { projectRoles } from '../../engine/xerScope';
import type { LoadedProject } from '../xerFile';
import { fmtBytes } from '../xerFile';
import type { ScheduleCtx } from './context';
import { fmtMs, fmtMsTime } from './timeline';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const YEAR = 365 * 86_400_000;

export function FileView({ ctx, loaded, fileName }: { ctx: ScheduleCtx; loaded: LoadedProject; fileName: string }) {
  const { model, project } = ctx;
  const roles = projectRoles(model);
  const h = model.header;
  const from = ctx.dataDate ?? Date.now();
  const codesUsed = new Map<string, number>();
  for (const [taskUid, m] of model.taskCodes) {
    if (model.taskByUid.get(taskUid)?.projUid !== project.uid) continue;
    for (const typeUid of m.keys()) codesUsed.set(typeUid, (codesUsed.get(typeUid) ?? 0) + 1);
  }
  const valuesOf = new Map<string, number>();
  for (const v of model.codeValues.values()) valuesOf.set(v.typeUid, (valuesOf.get(v.typeUid) ?? 0) + 1);
  const udfUsed = new Map<string, number>();
  for (const [taskUid, m] of model.taskUdfs) {
    if (model.taskByUid.get(taskUid)?.projUid !== project.uid) continue;
    for (const k of m.keys()) udfUsed.set(k, (udfUsed.get(k) ?? 0) + 1);
  }
  const hpd = model.calendars.get(project.calUid)?.hoursPerDay || 8;
  const exportedMs = h?.exportDate ? Date.parse(`${h.exportDate.slice(0, 10)}T00:00:00Z`) : NaN;
  const exported = Number.isFinite(exportedMs) ? fmtMs(exportedMs) : (h?.exportDate ?? '');
  const calUsed = new Map<string, number>();
  for (const t of ctx.tasks) calUsed.set(t.calUid, (calUsed.get(t.calUid) ?? 0) + 1);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="card">
        <h2 className="card-title">Project</h2>
        <dl className="sched-facts mt-2">
          {(
            [
              ['Project ID', project.shortName],
              ['Name', project.name],
              ['Data date', fmtMsTime(project.dataDate)],
              ['Planned start', fmtMs(project.planStart)],
              ['Must finish by', fmtMs(project.mustFinish)],
              ['Scheduled finish', fmtMs(project.scheduledFinish)],
              ['Last scheduled', fmtMsTime(project.lastScheduled)],
              ['Critical when', project.criticalBy === 'LONGEST_PATH' ? 'on the longest path' : `total float ≤ ${Math.round((project.criticalFloatHrs / hpd) * 10) / 10} days`],
              ['Activities', ctx.tasks.length.toLocaleString()],
              ['Relationships', model.rels.filter((r) => model.taskByUid.get(r.succUid)?.projUid === project.uid).length.toLocaleString()],
              ['Resource assignments', model.assignments.filter((a) => model.taskByUid.get(a.taskUid)?.projUid === project.uid).length.toLocaleString()],
              ['Baseline bars from', ctx.baselineLabel ?? 'no baseline'],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || '—'}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card">
        <h2 className="card-title">The file</h2>
        <dl className="sched-facts mt-2">
          {(
            [
              ['File', fileName],
              ['Size', fmtBytes(loaded.bytes)],
              ['Characters read as', loaded.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252'],
              ['P6 version', h?.version ?? ''],
              ['Exported', exported],
              ['Exported by', h?.user ?? ''],
              ['Projects in it', model.projects.map((p) => `${p.shortName}${roles.mains.includes(p) ? '' : ' (baseline)'}`).join(', ')],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || '—'}</dd>
            </div>
          ))}
        </dl>
        {model.warnings.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-[12px] text-[var(--warn)]">
            {model.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer">Every table in the file ({model.tableRows.length})</summary>
          <table className="tbl mt-1 sched-mini">
            <tbody>
              {model.tableRows.map((t) => (
                <tr key={t.name}>
                  <td className="mono">{t.name}</td>
                  <td className="num">{t.rows.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <div className="card xl:col-span-2">
        <h2 className="card-title">Calendars</h2>
        <table className="tbl mt-2 sched-mini">
          <thead>
            <tr>
              <th>Calendar</th>
              <th>Kind</th>
              <th className="num">h / day</th>
              {DAYS.map((d) => (
                <th key={d} className="num">
                  {d}
                </th>
              ))}
              <th className="num">Activities</th>
              <th>Days off in the next 12 months</th>
            </tr>
          </thead>
          <tbody>
            {[...model.calendars.values()].map((c) => {
              const wk = weekHours(c);
              const off = holidaysBetween(c, from, from + YEAR);
              return (
                <tr key={c.uid}>
                  <td>
                    {c.name}
                    {c.isDefault && <span className="ml-1 text-[11px] text-[var(--text-muted)]">(default)</span>}
                    {!c.patternRead && <span className="ml-1 text-[11px] tone-warn" title="The file does not carry this calendar's working pattern, so a Monday-to-Friday week is assumed.">pattern assumed</span>}
                  </td>
                  <td>{c.type.toLowerCase()}</td>
                  <td className="num">{c.hoursPerDay || ''}</td>
                  {wk.map((hrs, i) => (
                    <td key={i} className={`num${hrs ? '' : ' text-[var(--text-subtle)]'}`}>
                      {hrs ? hrs : '—'}
                    </td>
                  ))}
                  <td className="num">{(calUsed.get(c.uid) ?? 0).toLocaleString()}</td>
                  <td className="cell-text" style={{ maxWidth: '28rem' }} title={off.map((d) => fmtMs(d)).join(', ')}>
                    {off.length === 0 ? <span className="text-[var(--text-subtle)]">none</span> : `${off.length}: ${off.slice(0, 6).map((d) => fmtMs(d)).join(', ')}${off.length > 6 ? ' …' : ''}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="card-title">Activity codes</h2>
        {model.codeTypes.size === 0 ? (
          <div className="mt-1 text-[12px] text-[var(--text-subtle)]">None defined.</div>
        ) : (
          <table className="tbl mt-2 sched-mini">
            <thead>
              <tr>
                <th>Code</th>
                <th>Scope</th>
                <th className="num">Values</th>
                <th className="num">Activities coded</th>
              </tr>
            </thead>
            <tbody>
              {[...model.codeTypes.values()]
                .sort((a, b) => a.seq - b.seq)
                .map((c) => (
                  <tr key={c.uid}>
                    <td>{c.name}</td>
                    <td>{c.scope}</td>
                    <td className="num">{valuesOf.get(c.uid) ?? 0}</td>
                    <td className="num">{(codesUsed.get(c.uid) ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">User-defined fields on activities</h2>
        {[...model.udfTypes.values()].filter((u) => u.table === 'TASK').length === 0 ? (
          <div className="mt-1 text-[12px] text-[var(--text-subtle)]">None defined.</div>
        ) : (
          <table className="tbl mt-2 sched-mini">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th className="num">Activities with a value</th>
              </tr>
            </thead>
            <tbody>
              {[...model.udfTypes.values()]
                .filter((u) => u.table === 'TASK')
                .map((u) => (
                  <tr key={u.uid}>
                    <td>{u.label}</td>
                    <td>{u.dataType.toLowerCase()}</td>
                    <td className="num">{(udfUsed.get(u.uid) ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
