import { effectiveSeconds } from './pert';
import type { RefinementPlan } from './types';

export const DAILY_CAPACITY_SECONDS = 8 * 3600;
const MS_PER_DAY = 24 * 3600 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_DAYS = /^\+(\d{1,3})$/;
const SUNDAY = 0;
const SATURDAY = 6;
const TODAY_WORDS = ['hoy'];
const TOMORROW_WORDS = ['mañana', 'manana'];

export interface ScheduleItem {
  id: string;
  seconds: number;
}

const toIso = (date: Date): string => date.toISOString().slice(0, 10);

function parseIso(text: string): Date | null {
  const match = ISO_DATE.exec(text);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return toIso(date) === text ? date : null;
}

export const isValidIsoDate = (text: string): boolean => parseIso(text) !== null;

export function todayIso(now: Date = new Date()): string {
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, days: number): string {
  const date = parseIso(iso);
  if (!date) throw new Error(`Fecha inválida: "${iso}".`);
  return toIso(new Date(date.getTime() + days * MS_PER_DAY));
}

function isWeekend(iso: string): boolean {
  const day = (parseIso(iso) as Date).getUTCDay();
  return day === SATURDAY || day === SUNDAY;
}

function nextWorkday(iso: string): string {
  let next = addDays(iso, 1);
  while (isWeekend(next)) next = addDays(next, 1);
  return next;
}

// Llena el día en el orden del plan; solo al avanzar de día se saltan sábado y domingo
export function recommendSchedule(
  items: ScheduleItem[],
  today: string,
  dailyCapacitySeconds: number = DAILY_CAPACITY_SECONDS,
): Map<string, string> {
  const dates = new Map<string, string>();
  let day = today;
  let used = 0;
  for (const { id, seconds } of items) {
    if (used > 0 && used + seconds > dailyCapacitySeconds) {
      day = nextWorkday(day);
      used = 0;
    }
    dates.set(id, day);
    used += seconds;
  }
  return dates;
}

// Acepta YYYY-MM-DD, "hoy", "mañana" o "+N" (días corridos desde hoy)
export function parseDueDateInput(input: string, today: string): string {
  const text = input.trim().toLowerCase();
  if (TODAY_WORDS.includes(text)) return today;
  if (TOMORROW_WORDS.includes(text)) return addDays(today, 1);
  const relative = RELATIVE_DAYS.exec(text);
  if (relative) return addDays(today, Number(relative[1]));
  if (isValidIsoDate(text)) return text;
  throw new Error('Fecha inválida. Usa AAAA-MM-DD, "hoy", "mañana" o "+2".');
}

export interface ScheduleEntry {
  recommended: string;
  dueDate: string;
  manual: boolean;
}

// Solo las tareas marcadas ocupan días; las fechas manuales no alteran la recomendación de las demás
export function scheduleOf(plan: RefinementPlan, today: string): Map<string, ScheduleEntry> {
  const included = plan.tasks.filter((t) => t.include);
  const recommended = recommendSchedule(
    included.map((t) => ({ id: t.id, seconds: effectiveSeconds(t) })),
    today,
  );
  const entries = new Map<string, ScheduleEntry>();
  for (const task of included) {
    const manual = task.dueDateManual === true && Boolean(task.dueDate);
    const rec = recommended.get(task.id) as string;
    entries.set(task.id, { recommended: rec, dueDate: manual ? (task.dueDate as string) : rec, manual });
  }
  return entries;
}

export function daySeconds(plan: RefinementPlan, schedule: Map<string, ScheduleEntry>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const task of plan.tasks) {
    const entry = schedule.get(task.id);
    if (entry) totals[entry.dueDate] = (totals[entry.dueDate] ?? 0) + effectiveSeconds(task);
  }
  return totals;
}
