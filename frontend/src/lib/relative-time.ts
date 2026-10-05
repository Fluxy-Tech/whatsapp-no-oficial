const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

export function formatRelativeTime(date: string | Date): string {
  const diffMs = new Date(date).getTime() - Date.now();

  for (const [unit, unitMs] of UNITS) {
    const diffInUnit = diffMs / unitMs;
    if (Math.abs(diffInUnit) >= 1) {
      return formatter.format(Math.round(diffInUnit), unit);
    }
  }

  return formatter.format(Math.round(diffMs / 1000), "second");
}
