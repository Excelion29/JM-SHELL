import type { BrowseItem } from '../../refinement/types.js';
import { ISSUE_TYPE_COLORS, ISSUE_TYPE_NAMES } from '../texts.js';
import type { PickerItem } from './picker-list.js';

type ColoredType = keyof typeof ISSUE_TYPE_COLORS;
const COLORED_TYPES = Object.keys(ISSUE_TYPE_COLORS) as ColoredType[];

// Épica morada, historia verde, error rojo; tareas y otros tipos sin color
export function issueTypeColor(type: string | undefined): string | undefined {
  const lower = (type ?? '').toLowerCase();
  const match = COLORED_TYPES.find((colored) => ISSUE_TYPE_NAMES[colored].some((name) => lower.includes(name)));
  return match ? ISSUE_TYPE_COLORS[match] : undefined;
}

// Fila de lista para un ticket de Jira: la clave va pintada según su tipo
export function toPickerItem(item: BrowseItem): PickerItem {
  return {
    id: item.key,
    code: item.key,
    codeColor: issueTypeColor(item.type),
    label: item.summary,
    detail: item.status,
  };
}
