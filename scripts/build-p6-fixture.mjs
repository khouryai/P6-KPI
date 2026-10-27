// Builds fixtures/full-project.xer: an anonymised whole-project XER for the tests.
//
// tc-fixture.xer is the T&C slice only, the way the budget used to receive it. This
// is the whole project — construction, installation, T&C and milestones, with the
// logic between them, calendars with a lunch break and holidays, resources, activity
// codes, user fields, a notebook and a baseline project in the same file — so the
// Schedule screen and the scope rule can be tested against what P6 really exports.
//
// It is written in Windows-1252, as P6 on a Windows desktop writes it, so the
// decoding is tested too. Run with: node scripts/build-p6-fixture.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.cwd(), 'fixtures/full-project.xer');

/** Days since 30 Dec 1899, the epoch P6 calendars count exceptions from. */
const serial = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);

/** One node of P6's calendar bracket format: (0||name(attrs)(children)). */
const node = (name, attrs = '', children = []) => `(0||${name}(${attrs})(${children.join('')}))`;
const work = (i, s, f) => node(String(i), `s|${s}|f|${f}`);
/** Days of the week run 1 (Sunday) to 7 (Saturday). */
const days = (pattern) => node('DaysOfWeek', '', [1, 2, 3, 4, 5, 6, 7].map((d) => node(String(d), '', (pattern[d] ?? []).map(([s, f], i) => work(i, s, f)))));
const calendarData = (pattern, exceptions) =>
  // P6 writes its line breaks as 0x7F pairs; one is dropped in here to prove they are ignored.
  node('CalendarData', '', [`\x7f\x7f${days(pattern)}`, node('VIEW', 'ShowTotal|Y'), node('Exceptions', '', exceptions)]);

const lunch = [['08:00', '12:00'], ['13:00', '17:00']];
const standard = calendarData({ 2: lunch, 3: lunch, 4: lunch, 5: lunch, 6: lunch }, [
  node('0', `d|${serial('2026-11-26')}`),
  node('1', `d|${serial('2026-12-25')}`),
  node('2', `d|${serial('2026-12-24')}`, [work(0, '08:00', '12:00')]),
]);
const ten = [['07:00', '17:00']];
const fourTens = calendarData({ 2: ten, 3: ten, 4: ten, 5: ten }, []);

const tables = [];
const table = (name, fields, rows) => tables.push({ name, fields, rows });

table('CURRTYPE', ['curr_id', 'curr_short_name', 'curr_symbol'], [['1', 'USD', '$']]);

table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'clndr_data'], [
  ['1', 'Y', 'Standard 5 Day (lunch 12–13)', '', '', 'CA_Base', '8', '40', standard],
  ['2', 'N', 'Four Tens', '', '', 'CA_Base', '10', '40', fourTens],
]);

table('PROJECT', ['proj_id', 'proj_short_name', 'clndr_id', 'last_recalc_date', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'critical_drtn_hr_cnt', 'critical_path_type', 'orig_proj_id', 'sum_base_proj_id', 'last_schedule_date', 'export_flag'], [
  ['200', 'CBTC-PH2', '1', '2026-09-14 08:00', '2025-01-06 08:00', '', '2030-08-26 17:00', '0', 'CT_TotFloat', '', '201', '2026-09-14 09:12', 'Y'],
  ['201', 'CBTC-PH2-BL1', '1', '2025-01-06 08:00', '2025-01-06 08:00', '', '2030-06-28 17:00', '0', 'CT_TotFloat', '200', '', '2025-01-06 09:00', 'N'],
]);

table('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'proj_node_flag', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'], [
  ['1000', '200', '1', '0', 'Y', 'CBTC-PH2', 'CBTC Phase 2 (sample)', ''],
  ['1001', '200', '1', '10', 'N', 'CN', 'Construction', '1000'],
  ['1002', '200', '1', '20', 'N', 'IN', 'Installation', '1000'],
  ['1003', '200', '1', '30', 'N', 'TC', 'Testing & Commissioning', '1000'],
  ['1004', '200', '1', '10', 'N', 'A10', 'A10 – Alpha Station', '1003'],
  ['1005', '200', '1', '20', 'N', 'B20', 'B20 – Bravo Yard', '1003'],
  ['1007', '200', '1', '30', 'N', 'C30', 'C30 – Charlie Junction', '1003'],
  ['1006', '200', '1', '40', 'N', 'MS', 'Milestones', '1000'],
  ['2000', '201', '1', '0', 'Y', 'CBTC-PH2-BL1', 'CBTC Phase 2 – Baseline 1', ''],
  ['2003', '201', '1', '30', 'N', 'TC', 'Testing & Commissioning', '2000'],
]);

const TASK_FIELDS = [
  'task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'complete_pct_type', 'task_type', 'status_code', 'task_code', 'task_name',
  'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'act_work_qty', 'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt',
  'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date', 'early_start_date', 'early_end_date',
  'restart_date', 'reend_date', 'target_start_date', 'target_end_date', 'cstr_type', 'cstr_date2', 'cstr_type2', 'driving_path_flag',
];

/**
 * One activity. Dates are 'YYYY-MM-DD'; a start is 08:00 and a finish 17:00 on the
 * standard calendar, as P6 writes them.
 */
function task(t) {
  const s = (d) => (d ? `${d} 08:00` : '');
  const f = (d) => (d ? `${d} 17:00` : '');
  const status = t.af ? 'TK_Complete' : t.as ? 'TK_Active' : 'TK_NotStart';
  const es = t.as ? (t.af ? '' : '2026-09-14') : t.es;
  return [
    t.id, t.proj ?? '200', t.wbs, t.cal ?? '1', String(t.phys ?? 0), t.pct ?? 'CP_Drtn', t.type ?? 'TT_Task', status, t.code, t.name,
    t.af ? '' : String(t.tf ?? 0), t.af ? '' : String(t.ff ?? 0), String(t.rd ?? 0), '0', '0', '0', String(t.od ?? 0),
    t.cstrDate ? s(t.cstrDate) : '', s(t.as), f(t.af), t.af ? '' : s(t.ls ?? t.es), t.af ? '' : f(t.lf ?? t.ef), es ? s(es) : '', t.af ? '' : f(t.ef),
    t.af ? '' : s(t.as ? '2026-09-14' : t.es), t.af ? '' : f(t.ef), s(t.ps ?? t.as ?? t.es), f(t.pf ?? t.af ?? t.ef),
    t.cstr ?? '', '', '', t.dp ? 'Y' : 'N',
  ];
}

const tasks = [
  // Milestones
  { id: '3041', wbs: '1006', code: '0-P2-MS-0005', name: 'Phase 2 start', type: 'TT_Mile', as: '2025-01-06', af: '2025-01-06', od: 0 },
  { id: '3040', wbs: '1006', code: '0-P2-MS-0010', name: '[MS] - Program Milestone', type: 'TT_FinMile', es: '2030-08-26', ef: '2030-08-26', od: 0, tf: 40 },
  // Construction
  { id: '3000', wbs: '1001', code: '0-P2-CN-A10-FA-0010', name: 'A10 – Cable trough install', as: '2025-01-06', af: '2025-02-14', od: 240 },
  { id: '3001', wbs: '1001', code: '0-P2-CN-B20-FA-0010', name: 'B20 – Equipment room fit-out', as: '2026-08-03', es: '2026-08-03', ef: '2026-10-23', od: 480, rd: 240, tf: 0, dp: true },
  { id: '3002', wbs: '1001', code: '0-P2-CN-B20-FA-0020', name: 'B20 – Signal cable pull', es: '2026-09-21', ef: '2026-10-09', od: 120, rd: 120, tf: 80, ff: 0 },
  // Installation
  { id: '3010', wbs: '1002', code: '0-P2-IN-A10-FA-0010', name: 'A10 – Wayside equipment install', as: '2025-02-17', af: '2025-02-28', od: 80 },
  { id: '3011', wbs: '1002', code: '0-P2-IN-B20-FA-0010', name: 'B20 – Zone controller install', es: '2026-10-26', ef: '2026-10-30', od: 40, rd: 40, tf: 0, dp: true },
  { id: '3012', wbs: '1002', code: '0-P2-IN-C30-FA-0010', name: 'C30 – Radio install', es: '2026-09-28', ef: '2026-10-02', od: 40, rd: 40, tf: -40, cstr: 'CS_MSO', cstrDate: '2026-09-28' },
  { id: '3013', wbs: '1002', code: '0-P2-IN-B20-FA-0020', name: 'B20 – Antenna install', es: '2026-09-07', ef: '2026-09-11', od: 40, rd: 40, tf: 120 },
  // T&C, A10
  { id: '3020', wbs: '1004', code: '0-P2-TC-A10-FA-0010', name: '[T&C] A10 (Ph2) - Core Network Test', as: '2025-03-03', af: '2025-03-18', od: 96 },
  { id: '3021', wbs: '1004', code: '0-P2-TC-A10-FA-0020', name: '[T&C] A10 (Ph2) - Wayside SAT/SIT', as: '2025-04-01', af: '2025-04-21', od: 120 },
  { id: '3022', wbs: '1004', code: '0-P2-TC-A10-FA-0030', name: '[T&C] A10 (Ph2) - Pre-Simulation Test', as: '2026-08-18', es: '2026-08-18', ef: '2026-09-25', od: 80, rd: 32, tf: 16, phys: 60 },
  { id: '3023', wbs: '1004', code: '0-P2-TC-A10-FA-0040', name: '[T&C] A10 (Ph2) - Sim Mode Test (Adjacent Location) (DF: A10 → B20)', es: '2026-09-28', ef: '2026-10-02', od: 40, rd: 40, tf: 16 },
  { id: '3028', wbs: '1004', code: '0-P2-TC-A10-FA-0050', name: '[T&C] A10 (Ph2) - Regression Test', as: '2026-09-08', es: '2026-09-08', ef: '2026-11-20', od: 80, rd: 64, tf: 400 },
  // T&C, B20
  { id: '3024', wbs: '1005', code: '0-P2-TC-B20-FA-0010', name: '[T&C] B20 (Ph2) - Core Network Test', es: '2026-11-02', ef: '2026-11-17', od: 96, rd: 96, tf: 0, dp: true },
  { id: '3025', wbs: '1005', code: '0-P2-TC-B20-FA-0020', name: '[T&C] B20 (Ph2) - Wayside SAT/SIT', es: '2027-02-01', ef: '2027-02-19', od: 120, rd: 120, tf: 40 },
  { id: '3026', wbs: '1005', code: '0-P2-TC-B20-FA-0030', name: '[T&C] B20 (Ph2) - Cutover (By BART)', es: '2027-03-01', ef: '2027-03-26', od: 160, rd: 160, tf: 40, cstr: 'CS_MSOA', cstrDate: '2027-03-01' },
  { id: '3027', wbs: '1005', code: '0-P2-TC-B20-FA-0040', name: '[T&C] B20 (Ph2) - Long Hammock Support', type: 'TT_LOE', es: '2026-11-02', ef: '2027-02-05', od: 560, rd: 560, tf: 0 },
  { id: '3029', wbs: '1005', code: '0-P2-TC-B20-FA-0050', name: '[T&C] B20 (Ph2) - Wiring Prep (By Others)', es: '2026-09-21', ef: '2026-10-02', od: 80, rd: 80, tf: 600 },
  // T&C, C30: a four-tens calendar
  { id: '3030', wbs: '1007', cal: '2', code: '0-P2-TC-C30-FA-0010', name: '[T&C] C30 (Ph2) - Radio Test', es: '2026-10-05', ef: '2026-10-08', od: 40, rd: 40, tf: -40 },
  // The baseline, in the same file
  { id: '4020', proj: '201', wbs: '2003', code: '0-P2-TC-A10-FA-0010', name: '[T&C] A10 (Ph2) - Core Network Test', es: '2025-03-03', ef: '2025-03-14', od: 80, rd: 80 },
  { id: '4022', proj: '201', wbs: '2003', code: '0-P2-TC-A10-FA-0030', name: '[T&C] A10 (Ph2) - Pre-Simulation Test', es: '2026-06-01', ef: '2026-06-12', od: 80, rd: 80 },
  { id: '4023', proj: '201', wbs: '2003', code: '0-P2-TC-A10-FA-0040', name: '[T&C] A10 (Ph2) - Sim Mode Test (Adjacent Location) (DF: A10 → B20)', es: '2026-06-15', ef: '2026-06-19', od: 40, rd: 40 },
  { id: '4024', proj: '201', wbs: '2003', code: '0-P2-TC-B20-FA-0010', name: '[T&C] B20 (Ph2) - Core Network Test', es: '2026-08-03', ef: '2026-08-14', od: 80, rd: 80 },
  { id: '4025', proj: '201', wbs: '2003', code: '0-P2-TC-B20-FA-0020', name: '[T&C] B20 (Ph2) - Wayside SAT/SIT', es: '2026-12-01', ef: '2026-12-18', od: 120, rd: 120 },
];
table('TASK', TASK_FIELDS, tasks.map(task));

const rel = (id, succ, pred, type = 'PR_FS', lag = 0) => [id, succ, pred, '200', '200', type, String(lag)];
table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], [
  rel('5000', '3000', '3041'),
  rel('5001', '3010', '3000'),
  rel('5002', '3020', '3010'),
  rel('5003', '3021', '3020'),
  rel('5004', '3022', '3021'),
  rel('5005', '3023', '3022'),
  rel('5006', '3028', '3023'),
  rel('5007', '3011', '3001'),
  rel('5008', '3024', '3011'),
  rel('5009', '3025', '3024'),
  rel('5010', '3026', '3025'),
  rel('5011', '3040', '3026'),
  rel('5012', '3030', '3012'),
  rel('5013', '3030', '3002', 'PR_SS', -16),
  rel('5014', '3002', '3001', 'PR_SS', 0),
  rel('5015', '3027', '3024', 'PR_SS', 0),
  rel('5016', '3040', '3029', 'PR_SF', 0),
  rel('5017', '3012', '3001', 'PR_FS', 8),
  // A link to an activity in a project that was not exported with this one.
  rel('5018', '3025', '9999'),
]);

table('RSRC', ['rsrc_id', 'parent_rsrc_id', 'clndr_id', 'rsrc_short_name', 'rsrc_name', 'rsrc_type'], [
  ['500', '', '1', 'ATS-ENG', 'ATS Test Engineer', 'RT_Labor'],
  ['501', '', '1', 'IXL-ENG', 'IXL Test Engineer', 'RT_Labor'],
  ['502', '', '1', 'ELEC', 'Electrician', 'RT_Labor'],
  ['503', '', '1', 'CRANE', 'Mobile crane', 'RT_Equip'],
]);
table('ROLES', ['role_id', 'parent_role_id', 'seq_num', 'role_name', 'role_short_name'], [['600', '', '1', 'T&C Lead', 'TC-LEAD']]);

const asg = (id, task, rsrc, role, budget, remain, start, finish, type = 'RT_Labor') => [
  id, task, '200', rsrc, role, String(budget), String(remain), String(budget - remain), '0', `${start} 08:00`, `${finish} 17:00`, '', '', String(budget * 100), String(remain * 100), type,
];
table('TASKRSRC', ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'role_id', 'target_qty', 'remain_qty', 'act_reg_qty', 'act_ot_qty', 'target_start_date', 'target_end_date', 'restart_date', 'reend_date', 'target_cost', 'remain_cost', 'rsrc_type'], [
  asg('7000', '3022', '500', '', 160, 32, '2026-08-18', '2026-09-25'),
  asg('7001', '3023', '500', '', 80, 80, '2026-09-28', '2026-10-02'),
  asg('7002', '3023', '501', '', 40, 40, '2026-09-28', '2026-10-02'),
  asg('7003', '3024', '500', '', 192, 192, '2026-11-02', '2026-11-17'),
  asg('7004', '3025', '501', '', 240, 240, '2027-02-01', '2027-02-19'),
  asg('7005', '3001', '502', '', 600, 240, '2026-08-03', '2026-10-23'),
  asg('7006', '3002', '502', '', 240, 240, '2026-09-21', '2026-10-09'),
  asg('7007', '3002', '503', '', 24, 24, '2026-09-21', '2026-10-09', 'RT_Equip'),
  asg('7008', '3030', '', '600', 40, 40, '2026-10-05', '2026-10-08'),
]);

table('ACTVTYPE', ['actv_code_type_id', 'actv_short_len', 'seq_num', 'actv_code_type', 'proj_id', 'wbs_id', 'actv_code_type_scope'], [
  ['700', '10', '1', 'Responsible', '200', '', 'AS_Project'],
  ['701', '10', '2', 'Area', '', '', 'AS_Global'],
  ['702', '10', '3', 'Unused code', '', '', 'AS_Global'],
]);
table('ACTVCODE', ['actv_code_id', 'parent_actv_code_id', 'actv_code_type_id', 'actv_code_name', 'short_name', 'seq_num'], [
  ['710', '', '700', 'BART forces', 'BART', '1'],
  ['711', '', '700', 'Hitachi Rail', 'HRS', '2'],
  ['712', '', '700', 'Civil contractor', 'CONT', '3'],
  ['720', '', '701', 'North section', 'NORTH', '1'],
]);
const tcode = (task, type, code) => [task, type, code, '200'];
table('TASKACTV', ['task_id', 'actv_code_type_id', 'actv_code_id', 'proj_id'], [
  tcode('3026', '700', '710'),
  tcode('3024', '700', '711'),
  tcode('3025', '700', '711'),
  tcode('3022', '700', '711'),
  tcode('3001', '700', '712'),
  tcode('3002', '700', '712'),
  tcode('3011', '700', '712'),
  tcode('3012', '700', '712'),
  tcode('3024', '701', '720'),
]);

table('UDFTYPE', ['udf_type_id', 'table_name', 'udf_type_name', 'udf_type_label', 'logical_data_type', 'super_flag'], [
  ['800', 'TASK', 'user_field_800', 'Test procedure', 'FT_TEXT', 'N'],
  ['801', 'TASK', 'user_field_801', 'Readiness date', 'FT_END_DATE', 'N'],
  ['802', 'PROJWBS', 'user_field_802', 'WBS owner', 'FT_TEXT', 'N'],
  ['803', 'TASK', 'user_field_803', 'Test cases', 'FT_INT', 'N'],
]);
table('UDFVALUE', ['udf_type_id', 'fk_id', 'proj_id', 'udf_date', 'udf_number', 'udf_text', 'udf_code_id'], [
  ['800', '3024', '200', '', '', 'TP-B20-001 rev C', ''],
  ['801', '3024', '200', '2026-10-30 00:00', '', '', ''],
  ['803', '3024', '200', '', '42', '', ''],
  ['802', '1004', '200', '', '', 'Alpha team', ''],
]);

table('MEMOTYPE', ['memo_type_id', 'seq_num', 'eps_flag', 'proj_flag', 'wbs_flag', 'task_flag', 'memo_type'], [
  ['900', '1', 'N', 'N', 'N', 'Y', 'Scope'],
]);
table('TASKMEMO', ['memo_id', 'task_id', 'memo_type_id', 'proj_id', 'task_memo'], [
  ['950', '3024', '900', '200', '<HTML><BODY><p>Core network test for B20 – needs 2 nights.</p>\x7f\x7f<ul><li>Zone controller installed first</li><li>Access: nights &amp; weekends only</li></ul><script>alert(1)</script></BODY></HTML>'],
]);

let text = `ERMHDR\t19.12\t2026-09-14\tProject\tadmin\tSample Scheduler\tdbxDatabaseNoName\tProject Management\tUSD\r\n`;
for (const t of tables) {
  text += `%T\t${t.name}\r\n%F\t${t.fields.join('\t')}\r\n`;
  for (const r of t.rows) text += `%R\t${r.join('\t')}\r\n`;
}
text += '%E\r\n';

// Windows-1252, the way P6 writes it on a Windows desktop.
const CP1252 = { '–': 0x96, '—': 0x97, '’': 0x92, '“': 0x93, '”': 0x94, '€': 0x80, '…': 0x85 };
const bytes = [];
for (const ch of text) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
  else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
  else if (ch === '→') bytes.push(...Buffer.from('->', 'latin1'));
  else bytes.push(0x3f);
}
writeFileSync(out, Buffer.from(bytes));
console.log(`wrote ${out} (${bytes.length} bytes, ${tasks.length} activities)`);
