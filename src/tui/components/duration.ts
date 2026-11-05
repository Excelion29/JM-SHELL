import { ELLIPSIS, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from '../texts.js';

// Mismo formato que formatSeconds en src/utils/time.ts (la isla ESM no importa CJS)
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join('') : '0m';
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}${ELLIPSIS}` : text;
}
