/** Compact elapsed time for human-facing progress and completion messages. */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}

/** Exact deadline duration for timeout messages (for example `250ms`, `30s`, `20m`). */
export function formatDeadline(ms: number): string {
  const [unit, divisor] =
    ms >= 3_600_000
      ? (["h", 3_600_000] as const)
      : ms >= 60_000
        ? (["m", 60_000] as const)
        : ms >= 1000
          ? (["s", 1000] as const)
          : (["ms", 1] as const);
  return `${Number((ms / divisor).toFixed(3))}${unit}`;
}
