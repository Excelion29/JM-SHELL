// Parses strings like "1h", "30m", "1h30m" into seconds
export function parseTime(input: string): number {
  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?$/;
  const match = input.trim().match(pattern);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`Invalid time format: "${input}". Use formats like 1h, 30m, or 1h30m.`);
  }
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  return (hours * 3600) + (minutes * 60);
}

export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.length > 0 ? parts.join('') : '0m';
}
