/**
 * The whole P6 project, as the viewer reads it.
 *
 * Everything the file says about the schedule that a scheduler would look at: the
 * WBS, every activity with all of its dates and floats, the logic, the calendars,
 * the resources and what is assigned where, the activity codes, the user-defined
 * fields and the notebooks. Built once per file and held in memory; it is never
 * written anywhere, because the file it came from is.
 *
 * The budget does not read this. It still reads `P6Activity[]` — the T&C slice of
 * this model, cut by the scope rule in `xerScope.ts` — so every figure it produced
 * from an Excel export it produces identically from an XER.
 */
import { cell, columns, dateCell, numCell, memoText, scanXerAsync, scanXerSync, type XerHeader, type XerReaders, type XerScanner } from './xerText';
import { makeCalendar, type P6Calendar } from './xerCalendar';

export type TaskType = 'TASK' | 'RESOURCE' | 'LOE' | 'START_MS' | 'FINISH_MS' | 'WBS_SUMMARY';

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  TASK: 'Task dependent',
  RESOURCE: 'Resource dependent',
  LOE: 'Level of effort',
  START_MS: 'Start milestone',
  FINISH_MS: 'Finish milestone',
  WBS_SUMMARY: 'WBS summary',
};

const TASK_TYPES: Record<string, TaskType> = {
  TT_Task: 'TASK',
  TT_Rsrc: 'RESOURCE',
  TT_LOE: 'LOE',
  TT_Mile: 'START_MS',
  TT_FinMile: 'FINISH_MS',
  TT_WBS: 'WBS_SUMMARY',
};

export type TaskStatus = 'NOT STARTED' | 'IN PROGRESS' | 'COMPLETE';

export type PctType = 'Duration' | 'Units' | 'Physical';

/** P6's constraint types, by the code it writes. */
export const CONSTRAINT_LABEL: Record<string, string> = {
  CS_MSO: 'Start On',
  CS_MSOA: 'Start On or After',
  CS_MSOB: 'Start On or Before',
  CS_MEO: 'Finish On',
  CS_MEOA: 'Finish On or After',
  CS_MEOB: 'Finish On or Before',
  CS_MANDSTART: 'Mandatory Start',
  CS_MANDFIN: 'Mandatory Finish',
  CS_ALAP: 'As Late As Possible',
};

/**
 * Constraints that pin a date rather than merely bound it from one side. These are
 * the ones a schedule review flags, because they can hold a date the logic would
 * otherwise have moved and so hide a slip.
 */
export const HARD_CONSTRAINTS = new Set(['CS_MSO', 'CS_MEO', 'CS_MSOB', 'CS_MEOB', 'CS_MANDSTART', 'CS_MANDFIN']);

export type P6Task = {
  /** P6's internal key, `task_id`. Relationships, assignments and codes join on it. */
  uid: string;
  projUid: string;
  wbsUid: string;
  calUid: string;
  /** The Activity ID. */
  code: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  pctType: PctType;
  /** Physical percent complete as keyed in P6, 0 to 1. */
  physPct: number | null;
  /** Original and remaining duration, in hours. */
  odHrs: number | null;
  rdHrs: number | null;
  /** Hours per day on this activity's calendar, which turns its hours into days. */
  hpd: number;
  /** The Start and Finish P6 shows: actual where there is one, otherwise early. */
  start: number | null;
  finish: number | null;
  actStart: number | null;
  actFinish: number | null;
  earlyStart: number | null;
  earlyFinish: number | null;
  lateStart: number | null;
  lateFinish: number | null;
  plannedStart: number | null;
  plannedFinish: number | null;
  remStart: number | null;
  remFinish: number | null;
  expectFinish: number | null;
  cstrType: string;
  cstrDate: number | null;
  cstrType2: string;
  cstrDate2: number | null;
  /** Total and free float in hours. Absent on a completed activity, as in P6. */
  tfHrs: number | null;
  ffHrs: number | null;
  /** P6 marked this activity on the longest path when it last scheduled. */
  drivingPath: boolean;
  /** Labour units, in hours. */
  budgetUnits: number | null;
  actualUnits: number | null;
  remainingUnits: number | null;
  /** Position in the file, which is the order P6 exported in. */
  order: number;
};

export type P6Wbs = {
  uid: string;
  projUid: string;
  parentUid: string;
  /** The WBS short name; the path of these is the WBS code. */
  code: string;
  name: string;
  seq: number;
  /** The node that IS the project. Its name is the project's name. */
  isProjectNode: boolean;
  children: string[];
};

export type RelType = 'FS' | 'SS' | 'FF' | 'SF';

export type P6Rel = {
  uid: string;
  predUid: string;
  succUid: string;
  type: RelType;
  /** Lag in hours, on the predecessor's calendar unless the project says otherwise. */
  lagHrs: number;
};

export type ResourceType = 'Labor' | 'Nonlabor' | 'Material';

export type P6Resource = {
  uid: string;
  parentUid: string;
  code: string;
  name: string;
  type: ResourceType;
};

export type P6Role = { uid: string; code: string; name: string };

export type P6Assignment = {
  uid: string;
  taskUid: string;
  rsrcUid: string;
  roleUid: string;
  /** Units in hours for labour: what is planned, what is left, what was booked. */
  budgetQty: number;
  remainQty: number;
  actualQty: number;
  start: number | null;
  finish: number | null;
  remStart: number | null;
  remFinish: number | null;
  /** Cost at completion and remaining, in the file's currency. */
  budgetCost: number;
  remainCost: number;
  rsrcType: ResourceType | '';
};

export type P6CodeType = {
  uid: string;
  name: string;
  scope: 'Global' | 'EPS' | 'Project' | '';
  projUid: string;
  seq: number;
};

export type P6CodeValue = {
  uid: string;
  typeUid: string;
  parentUid: string;
  /** What P6 shows in a code column. */
  short: string;
  /** The description. */
  name: string;
  seq: number;
};

export type UdfDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'CODE' | 'INDICATOR' | 'COST' | '';

export type P6UdfType = { uid: string; table: string; label: string; dataType: UdfDataType };

/** A user-defined field's value on one activity, already in the form it is shown. */
export type P6UdfValue = string | number;

export type P6Memo = { type: string; text: string };

export type P6ProjectInfo = {
  uid: string;
  shortName: string;
  /** The project's name: the name on its project-level WBS node. */
  name: string;
  /** The data date, `last_recalc_date`: what the schedule was last updated to. */
  dataDate: number | null;
  planStart: number | null;
  /** The project's must-finish-by date, when one is set. */
  mustFinish: number | null;
  /** The finish the last schedule run calculated. */
  scheduledFinish: number | null;
  /** Total float at or below which an activity counts as critical, in hours. */
  criticalFloatHrs: number;
  /** Critical by total float, or by being on the longest path. */
  criticalBy: 'FLOAT' | 'LONGEST_PATH';
  /** Set on a baseline copy: the project it was taken from. */
  origProjUid: string;
  /** The baseline the project measures itself against. */
  baselineProjUid: string;
  calUid: string;
  lastScheduled: number | null;
  taskCount: number;
};

export type P6Project = {
  header: XerHeader | null;
  projects: P6ProjectInfo[];
  /** Every activity in the file, every project, in file order. */
  tasks: P6Task[];
  taskByUid: Map<string, P6Task>;
  wbs: Map<string, P6Wbs>;
  rels: P6Rel[];
  /** Relationships by successor (its predecessors) and by predecessor (its successors). */
  predsOf: Map<string, P6Rel[]>;
  succsOf: Map<string, P6Rel[]>;
  calendars: Map<string, P6Calendar>;
  resources: Map<string, P6Resource>;
  roles: Map<string, P6Role>;
  assignments: P6Assignment[];
  assignmentsOf: Map<string, P6Assignment[]>;
  codeTypes: Map<string, P6CodeType>;
  codeValues: Map<string, P6CodeValue>;
  /** Activity to (code type to code value). */
  taskCodes: Map<string, Map<string, string>>;
  udfTypes: Map<string, P6UdfType>;
  /** Activity to (field to value). Only activity-level fields are read. */
  taskUdfs: Map<string, Map<string, P6UdfValue>>;
  taskMemos: Map<string, P6Memo[]>;
  /** Every table in the file with its row count, for the "what is in this file" panel. */
  tableRows: { name: string; rows: number }[];
  warnings: string[];
};

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Everything the readers fill, before it is tidied into a `P6Project`. */
type Raw = {
  projects: Map<string, Omit<P6ProjectInfo, 'name' | 'taskCount'>>;
  calendars: Map<string, P6Calendar>;
  tasks: P6Task[];
  wbs: Map<string, P6Wbs>;
  rels: P6Rel[];
  resources: Map<string, P6Resource>;
  roles: Map<string, P6Role>;
  assignments: P6Assignment[];
  codeTypes: Map<string, P6CodeType>;
  codeValues: Map<string, P6CodeValue>;
  taskCodes: Map<string, Map<string, string>>;
  udfTypes: Map<string, P6UdfType>;
  udfCodes: Map<string, string>;
  udfRaw: { typeUid: string; fkUid: string; text: string; num: number | null; date: number | null; code: string }[];
  memoTypes: Map<string, string>;
  memos: { taskUid: string; typeUid: string; html: string }[];
};

const rsrcTypeOf = (v: string): ResourceType | '' => (v === 'RT_Labor' ? 'Labor' : v === 'RT_Equip' ? 'Nonlabor' : v === 'RT_Mat' ? 'Material' : '');

const statusOf = (code: string, actStart: number | null, actFinish: number | null): TaskStatus => {
  if (code === 'TK_Complete') return 'COMPLETE';
  if (code === 'TK_Active') return 'IN PROGRESS';
  if (code === 'TK_NotStart') return 'NOT STARTED';
  return actFinish !== null ? 'COMPLETE' : actStart !== null ? 'IN PROGRESS' : 'NOT STARTED';
};

const pctTypeOf = (v: string): PctType => (v === 'CP_Units' ? 'Units' : v === 'CP_Phys' ? 'Physical' : 'Duration');

const udfTypeOf = (v: string): UdfDataType => {
  if (v === 'FT_TEXT') return 'TEXT';
  if (v === 'FT_START_DATE' || v === 'FT_END_DATE') return 'DATE';
  if (v === 'FT_INT' || v === 'FT_FLOAT_2_DECIMALS') return 'NUMBER';
  if (v === 'FT_MONEY') return 'COST';
  if (v === 'FT_STATICTYPE') return 'CODE';
  if (v === 'FT_INDICATOR') return 'INDICATOR';
  return '';
};

function readers(raw: Raw): XerReaders {
  let order = 0;
  return {
    PROJECT: (f) => {
      const c = columns(f, ['proj_id', 'proj_short_name', 'last_recalc_date', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'critical_drtn_hr_cnt', 'critical_path_type', 'orig_proj_id', 'sum_base_proj_id', 'clndr_id', 'last_schedule_date'] as const);
      return (r) => {
        const uid = cell(r, c.proj_id);
        if (!uid) return;
        raw.projects.set(uid, {
          uid,
          shortName: cell(r, c.proj_short_name) || uid,
          dataDate: dateCell(r, c.last_recalc_date),
          planStart: dateCell(r, c.plan_start_date),
          mustFinish: dateCell(r, c.plan_end_date),
          scheduledFinish: dateCell(r, c.scd_end_date),
          criticalFloatHrs: numCell(r, c.critical_drtn_hr_cnt) ?? 0,
          criticalBy: cell(r, c.critical_path_type) === 'CT_DrivPath' ? 'LONGEST_PATH' : 'FLOAT',
          origProjUid: cell(r, c.orig_proj_id),
          baselineProjUid: cell(r, c.sum_base_proj_id),
          calUid: cell(r, c.clndr_id),
          lastScheduled: dateCell(r, c.last_schedule_date),
        });
      };
    },
    CALENDAR: (f) => {
      const c = columns(f, ['clndr_id', 'clndr_name', 'clndr_type', 'proj_id', 'day_hr_cnt', 'clndr_data', 'default_flag'] as const);
      return (r) => {
        const uid = cell(r, c.clndr_id);
        if (!uid) return;
        raw.calendars.set(
          uid,
          makeCalendar({
            uid,
            name: cell(r, c.clndr_name),
            type: cell(r, c.clndr_type),
            projUid: cell(r, c.proj_id),
            hoursPerDay: numCell(r, c.day_hr_cnt),
            data: c.clndr_data >= 0 ? (r[c.clndr_data] ?? '') : '',
            isDefault: cell(r, c.default_flag) === 'Y',
          }),
        );
      };
    },
    PROJWBS: (f) => {
      const c = columns(f, ['wbs_id', 'proj_id', 'parent_wbs_id', 'wbs_short_name', 'wbs_name', 'seq_num', 'proj_node_flag'] as const);
      return (r) => {
        const uid = cell(r, c.wbs_id);
        if (!uid) return;
        raw.wbs.set(uid, {
          uid,
          projUid: cell(r, c.proj_id),
          parentUid: cell(r, c.parent_wbs_id),
          code: cell(r, c.wbs_short_name),
          name: cell(r, c.wbs_name),
          seq: numCell(r, c.seq_num) ?? 0,
          isProjectNode: cell(r, c.proj_node_flag) === 'Y',
          children: [],
        });
      };
    },
    TASK: (f) => {
      const c = columns(f, [
        'task_id', 'proj_id', 'wbs_id', 'clndr_id', 'task_code', 'task_name', 'task_type', 'status_code', 'complete_pct_type', 'phys_complete_pct',
        'target_drtn_hr_cnt', 'orig_drtn_hr_cnt', 'remain_drtn_hr_cnt', 'act_start_date', 'act_end_date', 'early_start_date', 'early_end_date',
        'late_start_date', 'late_end_date', 'target_start_date', 'target_end_date', 'restart_date', 'reend_date', 'expect_end_date',
        'cstr_type', 'cstr_date', 'cstr_type2', 'cstr_date2', 'total_float_hr_cnt', 'free_float_hr_cnt', 'driving_path_flag',
        'target_work_qty', 'act_work_qty', 'remain_work_qty',
      ] as const);
      return (r) => {
        const uid = cell(r, c.task_id);
        const code = cell(r, c.task_code);
        if (!uid || !code) return;
        const actStart = dateCell(r, c.act_start_date);
        const actFinish = dateCell(r, c.act_end_date);
        const earlyStart = dateCell(r, c.early_start_date);
        const earlyFinish = dateCell(r, c.early_end_date);
        const plannedStart = dateCell(r, c.target_start_date);
        const plannedFinish = dateCell(r, c.target_end_date);
        const remStart = dateCell(r, c.restart_date);
        const remFinish = dateCell(r, c.reend_date);
        const phys = numCell(r, c.phys_complete_pct);
        const od = numCell(r, c.target_drtn_hr_cnt) ?? numCell(r, c.orig_drtn_hr_cnt);
        raw.tasks.push({
          uid,
          projUid: cell(r, c.proj_id),
          wbsUid: cell(r, c.wbs_id),
          calUid: cell(r, c.clndr_id),
          code,
          name: cell(r, c.task_name),
          type: TASK_TYPES[cell(r, c.task_type)] ?? 'TASK',
          status: statusOf(cell(r, c.status_code), actStart, actFinish),
          pctType: pctTypeOf(cell(r, c.complete_pct_type)),
          physPct: phys === null ? null : Math.max(0, Math.min(1, phys / 100)),
          odHrs: od,
          rdHrs: numCell(r, c.remain_drtn_hr_cnt),
          hpd: 0,
          // The same order of preference the budget import uses, so the dates on the
          // viewer and the dates in the budget are one set of dates.
          start: actStart ?? earlyStart ?? plannedStart ?? remStart,
          finish: actFinish ?? earlyFinish ?? plannedFinish ?? remFinish,
          actStart,
          actFinish,
          earlyStart,
          earlyFinish,
          lateStart: dateCell(r, c.late_start_date),
          lateFinish: dateCell(r, c.late_end_date),
          plannedStart,
          plannedFinish,
          remStart,
          remFinish,
          expectFinish: dateCell(r, c.expect_end_date),
          cstrType: cell(r, c.cstr_type),
          cstrDate: dateCell(r, c.cstr_date),
          cstrType2: cell(r, c.cstr_type2),
          cstrDate2: dateCell(r, c.cstr_date2),
          tfHrs: numCell(r, c.total_float_hr_cnt),
          ffHrs: numCell(r, c.free_float_hr_cnt),
          drivingPath: cell(r, c.driving_path_flag) === 'Y',
          budgetUnits: numCell(r, c.target_work_qty),
          actualUnits: numCell(r, c.act_work_qty),
          remainingUnits: numCell(r, c.remain_work_qty),
          order: order++,
        });
      };
    },
    TASKPRED: (f) => {
      const c = columns(f, ['task_pred_id', 'task_id', 'pred_task_id', 'pred_type', 'lag_hr_cnt'] as const);
      return (r) => {
        const succUid = cell(r, c.task_id);
        const predUid = cell(r, c.pred_task_id);
        if (!succUid || !predUid) return;
        const t = cell(r, c.pred_type);
        raw.rels.push({
          uid: cell(r, c.task_pred_id) || `${predUid}>${succUid}`,
          predUid,
          succUid,
          type: t === 'PR_SS' ? 'SS' : t === 'PR_FF' ? 'FF' : t === 'PR_SF' ? 'SF' : 'FS',
          lagHrs: numCell(r, c.lag_hr_cnt) ?? 0,
        });
      };
    },
    RSRC: (f) => {
      const c = columns(f, ['rsrc_id', 'parent_rsrc_id', 'rsrc_short_name', 'rsrc_name', 'rsrc_type'] as const);
      return (r) => {
        const uid = cell(r, c.rsrc_id);
        if (!uid) return;
        raw.resources.set(uid, {
          uid,
          parentUid: cell(r, c.parent_rsrc_id),
          code: cell(r, c.rsrc_short_name) || uid,
          name: cell(r, c.rsrc_name) || cell(r, c.rsrc_short_name) || uid,
          type: rsrcTypeOf(cell(r, c.rsrc_type)) || 'Labor',
        });
      };
    },
    ROLES: (f) => {
      const c = columns(f, ['role_id', 'role_short_name', 'role_name'] as const);
      return (r) => {
        const uid = cell(r, c.role_id);
        if (uid) raw.roles.set(uid, { uid, code: cell(r, c.role_short_name) || uid, name: cell(r, c.role_name) || cell(r, c.role_short_name) || uid });
      };
    },
    TASKRSRC: (f) => {
      const c = columns(f, [
        'taskrsrc_id', 'task_id', 'rsrc_id', 'role_id', 'target_qty', 'remain_qty', 'act_reg_qty', 'act_ot_qty', 'target_start_date', 'target_end_date',
        'restart_date', 'reend_date', 'act_start_date', 'act_end_date', 'target_cost', 'remain_cost', 'rsrc_type',
      ] as const);
      return (r) => {
        const taskUid = cell(r, c.task_id);
        if (!taskUid) return;
        raw.assignments.push({
          uid: cell(r, c.taskrsrc_id) || `${taskUid}:${raw.assignments.length}`,
          taskUid,
          rsrcUid: cell(r, c.rsrc_id),
          roleUid: cell(r, c.role_id),
          budgetQty: numCell(r, c.target_qty) ?? 0,
          remainQty: numCell(r, c.remain_qty) ?? 0,
          actualQty: (numCell(r, c.act_reg_qty) ?? 0) + (numCell(r, c.act_ot_qty) ?? 0),
          start: dateCell(r, c.act_start_date) ?? dateCell(r, c.target_start_date),
          finish: dateCell(r, c.act_end_date) ?? dateCell(r, c.target_end_date),
          remStart: dateCell(r, c.restart_date),
          remFinish: dateCell(r, c.reend_date),
          budgetCost: numCell(r, c.target_cost) ?? 0,
          remainCost: numCell(r, c.remain_cost) ?? 0,
          rsrcType: rsrcTypeOf(cell(r, c.rsrc_type)),
        });
      };
    },
    ACTVTYPE: (f) => {
      const c = columns(f, ['actv_code_type_id', 'actv_code_type', 'actv_code_type_scope', 'proj_id', 'seq_num'] as const);
      return (r) => {
        const uid = cell(r, c.actv_code_type_id);
        if (!uid) return;
        const scope = cell(r, c.actv_code_type_scope);
        raw.codeTypes.set(uid, {
          uid,
          name: cell(r, c.actv_code_type) || uid,
          scope: scope === 'AS_Global' ? 'Global' : scope === 'AS_EPS' ? 'EPS' : scope === 'AS_Project' ? 'Project' : '',
          projUid: cell(r, c.proj_id),
          seq: numCell(r, c.seq_num) ?? 0,
        });
      };
    },
    ACTVCODE: (f) => {
      const c = columns(f, ['actv_code_id', 'actv_code_type_id', 'parent_actv_code_id', 'short_name', 'actv_code_name', 'seq_num'] as const);
      return (r) => {
        const uid = cell(r, c.actv_code_id);
        if (!uid) return;
        raw.codeValues.set(uid, {
          uid,
          typeUid: cell(r, c.actv_code_type_id),
          parentUid: cell(r, c.parent_actv_code_id),
          short: cell(r, c.short_name) || cell(r, c.actv_code_name) || uid,
          name: cell(r, c.actv_code_name),
          seq: numCell(r, c.seq_num) ?? 0,
        });
      };
    },
    TASKACTV: (f) => {
      const c = columns(f, ['task_id', 'actv_code_type_id', 'actv_code_id'] as const);
      return (r) => {
        const taskUid = cell(r, c.task_id);
        const valueUid = cell(r, c.actv_code_id);
        if (!taskUid || !valueUid) return;
        let m = raw.taskCodes.get(taskUid);
        if (!m) raw.taskCodes.set(taskUid, (m = new Map()));
        m.set(cell(r, c.actv_code_type_id), valueUid);
      };
    },
    UDFTYPE: (f) => {
      const c = columns(f, ['udf_type_id', 'table_name', 'udf_type_label', 'udf_type_name', 'logical_data_type'] as const);
      return (r) => {
        const uid = cell(r, c.udf_type_id);
        if (!uid) return;
        raw.udfTypes.set(uid, { uid, table: cell(r, c.table_name), label: cell(r, c.udf_type_label) || cell(r, c.udf_type_name) || uid, dataType: udfTypeOf(cell(r, c.logical_data_type)) });
      };
    },
    UDFCODE: (f) => {
      const c = columns(f, ['udf_code_id', 'short_name', 'udf_code_name'] as const);
      return (r) => {
        const uid = cell(r, c.udf_code_id);
        if (uid) raw.udfCodes.set(uid, cell(r, c.short_name) || cell(r, c.udf_code_name));
      };
    },
    UDFVALUE: (f) => {
      const c = columns(f, ['udf_type_id', 'fk_id', 'udf_text', 'udf_number', 'udf_date', 'udf_code_id'] as const);
      return (r) => {
        const fkUid = cell(r, c.fk_id);
        const typeUid = cell(r, c.udf_type_id);
        if (!fkUid || !typeUid) return;
        raw.udfRaw.push({ typeUid, fkUid, text: cell(r, c.udf_text), num: numCell(r, c.udf_number), date: dateCell(r, c.udf_date), code: cell(r, c.udf_code_id) });
      };
    },
    MEMOTYPE: (f) => {
      const c = columns(f, ['memo_type_id', 'memo_type'] as const);
      return (r) => {
        const uid = cell(r, c.memo_type_id);
        if (uid) raw.memoTypes.set(uid, cell(r, c.memo_type) || 'Notes');
      };
    },
    TASKMEMO: (f) => {
      const c = columns(f, ['task_id', 'memo_type_id', 'task_memo'] as const);
      return (r) => {
        const taskUid = cell(r, c.task_id);
        if (!taskUid) return;
        raw.memos.push({ taskUid, typeUid: cell(r, c.memo_type_id), html: c.task_memo >= 0 ? (r[c.task_memo] ?? '') : '' });
      };
    },
  };
}

function emptyRaw(): Raw {
  return {
    projects: new Map(),
    calendars: new Map(),
    tasks: [],
    wbs: new Map(),
    rels: [],
    resources: new Map(),
    roles: new Map(),
    assignments: [],
    codeTypes: new Map(),
    codeValues: new Map(),
    taskCodes: new Map(),
    udfTypes: new Map(),
    udfCodes: new Map(),
    udfRaw: [],
    memoTypes: new Map(),
    memos: [],
  };
}

export type BuildOptions = {
  /** Hours per day for an activity whose calendar is missing from the file. P6's own default is 8. */
  hoursPerDay?: number;
};

function finish(raw: Raw, scan: XerScanner, opts: BuildOptions): P6Project {
  const warnings: string[] = [];
  const fallbackHpd = opts.hoursPerDay && opts.hoursPerDay > 0 ? opts.hoursPerDay : 8;

  // Hours per day for every activity, from its own calendar where the file has it.
  let noCalendar = 0;
  const taskByUid = new Map<string, P6Task>();
  for (const t of raw.tasks) {
    const cal = raw.calendars.get(t.calUid);
    if (cal && cal.hoursPerDay > 0) t.hpd = cal.hoursPerDay;
    else {
      t.hpd = fallbackHpd;
      noCalendar += 1;
    }
    taskByUid.set(t.uid, t);
  }
  if (noCalendar > 0 && raw.tasks.length > 0) {
    warnings.push(`${noCalendar} activities have no calendar in the file, so their hours were read at ${fallbackHpd} hours a day.`);
  }

  // The WBS as a tree, children in P6's own order.
  for (const w of raw.wbs.values()) {
    const parent = raw.wbs.get(w.parentUid);
    if (parent && parent !== w) parent.children.push(w.uid);
  }
  const bySeq = (a: string, b: string) => {
    const x = raw.wbs.get(a)!;
    const y = raw.wbs.get(b)!;
    return x.seq - y.seq || x.code.localeCompare(y.code, undefined, { numeric: true });
  };
  for (const w of raw.wbs.values()) w.children.sort(bySeq);

  // Relationships both ways. One whose activity is not in the file — a link to
  // another project that was not exported with this one — is kept off both lists.
  const predsOf = new Map<string, P6Rel[]>();
  const succsOf = new Map<string, P6Rel[]>();
  let external = 0;
  const rels: P6Rel[] = [];
  for (const r of raw.rels) {
    if (!taskByUid.has(r.predUid) || !taskByUid.has(r.succUid)) {
      external += 1;
      continue;
    }
    rels.push(r);
    push(predsOf, r.succUid, r);
    push(succsOf, r.predUid, r);
  }
  if (external > 0) {
    warnings.push(
      external === 1
        ? '1 relationship links to an activity in a project that is not in this file, so it is not shown.'
        : `${external} relationships link to activities in projects that are not in this file, so they are not shown.`,
    );
  }

  const assignmentsOf = new Map<string, P6Assignment[]>();
  for (const a of raw.assignments) push(assignmentsOf, a.taskUid, a);

  // Activity-level user fields only, each already in the form it is shown in.
  const taskUdfs = new Map<string, Map<string, P6UdfValue>>();
  for (const u of raw.udfRaw) {
    const type = raw.udfTypes.get(u.typeUid);
    if (!type || type.table !== 'TASK' || !taskByUid.has(u.fkUid)) continue;
    let v: P6UdfValue | null = null;
    if (type.dataType === 'DATE') v = u.date !== null ? new Date(u.date).toISOString().slice(0, 10) : null;
    else if (type.dataType === 'NUMBER' || type.dataType === 'COST') v = u.num;
    else if (type.dataType === 'CODE') v = raw.udfCodes.get(u.code) ?? (u.code || null);
    else v = u.text || (u.num !== null ? u.num : null);
    if (v === null || v === '') continue;
    let m = taskUdfs.get(u.fkUid);
    if (!m) taskUdfs.set(u.fkUid, (m = new Map()));
    m.set(u.typeUid, v);
  }

  const taskMemos = new Map<string, P6Memo[]>();
  for (const m of raw.memos) {
    const text = memoText(m.html);
    if (text) push(taskMemos, m.taskUid, { type: raw.memoTypes.get(m.typeUid) ?? 'Notes', text });
  }

  const counts = new Map<string, number>();
  for (const t of raw.tasks) counts.set(t.projUid, (counts.get(t.projUid) ?? 0) + 1);
  const projectNodeName = new Map<string, string>();
  for (const w of raw.wbs.values()) if (w.isProjectNode && w.name) projectNodeName.set(w.projUid, w.name);
  const projects: P6ProjectInfo[] = [...raw.projects.values()].map((p) => ({ ...p, name: projectNodeName.get(p.uid) ?? p.shortName, taskCount: counts.get(p.uid) ?? 0 }));
  // Activities of a project the PROJECT table does not list still get a project to sit in.
  for (const [uid, n] of counts) {
    if (raw.projects.has(uid)) continue;
    projects.push({
      uid, shortName: uid, name: projectNodeName.get(uid) ?? uid, dataDate: null, planStart: null, mustFinish: null, scheduledFinish: null,
      criticalFloatHrs: 0, criticalBy: 'FLOAT', origProjUid: '', baselineProjUid: '', calUid: '', lastScheduled: null, taskCount: n,
    });
  }

  if (!scan.sawTable) warnings.push('This file has no XER tables in it. Is it really a P6 .xer export?');
  else if (raw.tasks.length === 0) warnings.push('The file has no activities (no TASK table).');

  return {
    header: scan.header,
    projects,
    tasks: raw.tasks,
    taskByUid,
    wbs: raw.wbs,
    rels,
    predsOf,
    succsOf,
    calendars: raw.calendars,
    resources: raw.resources,
    roles: raw.roles,
    assignments: raw.assignments,
    assignmentsOf,
    codeTypes: raw.codeTypes,
    codeValues: raw.codeValues,
    taskCodes: raw.taskCodes,
    udfTypes: raw.udfTypes,
    taskUdfs,
    taskMemos,
    tableRows: scan.tables.map((name) => ({ name, rows: scan.rowCounts.get(name) ?? 0 })),
    warnings,
  };
}

/** Read a whole XER text in one go. */
export function readProject(text: string, opts: BuildOptions = {}): P6Project {
  const raw = emptyRaw();
  const scan = scanXerSync(text, readers(raw));
  return finish(raw, scan, opts);
}

/** Read a whole XER text, yielding to the browser between steps. */
export async function readProjectAsync(text: string, opts: BuildOptions = {}, onProgress?: (p: number) => void): Promise<P6Project> {
  const raw = emptyRaw();
  const scan = await scanXerAsync(text, readers(raw), onProgress);
  return finish(raw, scan, opts);
}

// ---- reading the model ------------------------------------------------------

/** Days from hours on an activity's own calendar, to two decimals. */
export function hrsToDays(hrs: number | null, hpd: number): number | null {
  if (hrs === null || !Number.isFinite(hrs)) return null;
  return Math.round((hrs / (hpd > 0 ? hpd : 8)) * 100) / 100;
}

export function totalFloatDays(t: P6Task): number | null {
  return t.status === 'COMPLETE' ? null : hrsToDays(t.tfHrs, t.hpd);
}

export function freeFloatDays(t: P6Task): number | null {
  return t.status === 'COMPLETE' ? null : hrsToDays(t.ffHrs, t.hpd);
}

/**
 * Critical as the project defines it: total float at or below its threshold, or on
 * the longest path when the project is set that way. A finished activity is never
 * critical — its float is gone because the work is done, not because it is late.
 */
export function isCritical(t: P6Task, p: P6ProjectInfo | undefined): boolean {
  if (t.status === 'COMPLETE') return false;
  if (p?.criticalBy === 'LONGEST_PATH') return t.drivingPath;
  if (t.tfHrs === null) return false;
  return t.tfHrs <= (p?.criticalFloatHrs ?? 0) + 1e-9;
}

/** Percent complete P6 would show for this activity's percent complete type, 0 to 1. */
export function p6Percent(t: P6Task): number {
  if (t.status === 'COMPLETE') return 1;
  if (t.pctType === 'Physical') return t.physPct ?? 0;
  if (t.pctType === 'Units') {
    const total = (t.actualUnits ?? 0) + (t.remainingUnits ?? 0);
    return total > 0 ? (t.actualUnits ?? 0) / total : 0;
  }
  if (t.status === 'NOT STARTED') return 0;
  const od = t.odHrs ?? 0;
  if (od <= 0) return 0;
  return Math.max(0, Math.min(1, (od - (t.rdHrs ?? 0)) / od));
}

/** The chain of WBS nodes from the project down to this one. */
export function wbsChain(model: P6Project, wbsUid: string): P6Wbs[] {
  const out: P6Wbs[] = [];
  const seen = new Set<string>();
  let w = model.wbs.get(wbsUid);
  while (w && !seen.has(w.uid)) {
    seen.add(w.uid);
    out.unshift(w);
    w = model.wbs.get(w.parentUid);
  }
  return out;
}

/** The WBS code P6 shows: short names joined by dots, from the project down. */
export function wbsCode(model: P6Project, wbsUid: string): string {
  return wbsChain(model, wbsUid)
    .map((w) => w.code)
    .filter(Boolean)
    .join('.');
}

/** The WBS as a readable path, without the project node itself. */
export function wbsPathName(model: P6Project, wbsUid: string): string {
  return wbsChain(model, wbsUid)
    .filter((w) => !w.isProjectNode)
    .map((w) => w.name || w.code)
    .join(' › ');
}

/** An activity's code value for one code type, as shown in a column. */
export function codeOf(model: P6Project, taskUid: string, typeUid: string): P6CodeValue | null {
  const v = model.taskCodes.get(taskUid)?.get(typeUid);
  return v ? (model.codeValues.get(v) ?? null) : null;
}

/** Code types that any activity of this project actually uses, in P6's order. */
export function codeTypesInUse(model: P6Project, projUid: string): P6CodeType[] {
  const used = new Set<string>();
  for (const t of model.tasks) {
    if (t.projUid !== projUid) continue;
    const m = model.taskCodes.get(t.uid);
    if (m) for (const k of m.keys()) used.add(k);
  }
  return [...model.codeTypes.values()].filter((c) => used.has(c.uid)).sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));
}

/** User fields that any activity of this project carries. */
export function udfTypesInUse(model: P6Project, projUid: string): P6UdfType[] {
  const used = new Set<string>();
  for (const t of model.tasks) {
    if (t.projUid !== projUid) continue;
    const m = model.taskUdfs.get(t.uid);
    if (m) for (const k of m.keys()) used.add(k);
  }
  return [...model.udfTypes.values()].filter((u) => used.has(u.uid)).sort((a, b) => a.label.localeCompare(b.label));
}

/** What the activity is resourced with, one line per resource. */
export function assignmentLines(model: P6Project, taskUid: string): { resource: string; code: string; role: string; type: ResourceType | ''; budget: number; remaining: number; actual: number; budgetCost: number }[] {
  return (model.assignmentsOf.get(taskUid) ?? []).map((a) => {
    const r = model.resources.get(a.rsrcUid);
    const role = model.roles.get(a.roleUid);
    return {
      resource: r?.name ?? (role ? `(role) ${role.name}` : 'Unassigned'),
      code: r?.code ?? role?.code ?? '',
      role: role?.name ?? '',
      type: a.rsrcType || r?.type || '',
      budget: a.budgetQty,
      remaining: a.remainQty,
      actual: a.actualQty,
      budgetCost: a.budgetCost,
    };
  });
}

/** The project's activities, in file order. */
export function tasksOf(model: P6Project, projUid: string): P6Task[] {
  return model.tasks.filter((t) => t.projUid === projUid);
}
