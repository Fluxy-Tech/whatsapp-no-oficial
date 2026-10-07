import { useState } from "react";
import { cn } from "@/lib/utils";

export type ColumnDatum = {
  /** Axis label (short: "Jan", "15", "09h"). */
  label: string;
  /** Tooltip / table label ("Janeiro de 2026"). */
  fullLabel: string;
  value: number;
};

type ColumnChartProps = {
  data: ColumnDatum[];
  /** Describes the series (screen readers + table caption). */
  caption: string;
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
};

const NUMBER = new Intl.NumberFormat("pt-BR");

/** Clean axis maximum: 1, 2 or 5 × 10^n at or above the largest value. */
function niceMax(value: number) {
  if (value <= 0) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

/**
 * Single-series column chart: thin columns (≤ 24px, 4px rounded top) on one
 * baseline, hairline grid, value on the highest column only, a tooltip per
 * column on hover/focus and a visually hidden table with every value.
 */
export function ColumnChart({ data, caption, formatValue = (v) => NUMBER.format(v), height = 240, className }: ColumnChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  const peak = data.reduce((best, d, index) => (d.value > (data[best]?.value ?? 0) ? index : best), 0);
  const showPeak = (data[peak]?.value ?? 0) > 0;

  return (
    <figure className={cn("w-full", className)}>
      <div className="flex gap-2" style={{ height }}>
        {/* Y axis */}
        <div className="relative w-10 shrink-0 text-right text-[11px] text-muted-foreground" aria-hidden>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(tick / max) * 100}%` }}>
              {NUMBER.format(tick)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div className="relative min-w-0 flex-1" aria-hidden>
          {ticks.map((tick) => (
            <div
              key={tick}
              className={cn("absolute inset-x-0 h-px", tick === 0 ? "bg-border" : "bg-border/60")}
              style={{ bottom: `${(tick / max) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex">
            {data.map((d, index) => {
              const ratio = d.value / max;
              const isActive = active === index;
              return (
                <div
                  key={d.label}
                  className={cn("relative flex h-full flex-1 items-end justify-center", isActive && "bg-accent/50")}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                >
                  {d.value > 0 && (
                    <div
                      className="relative w-[60%] max-w-6 rounded-t bg-primary transition-opacity"
                      style={{ height: `${ratio * 100}%`, opacity: active === null || isActive ? 1 : 0.55 }}
                    >
                      {showPeak && index === peak && !isActive && (
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-foreground">
                          {formatValue(d.value)}
                        </span>
                      )}
                    </div>
                  )}

                  {isActive && (
                    <div
                      className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md"
                      style={{ left: "50%", bottom: `calc(${Math.min(ratio, 0.85) * 100}% + 8px)` }}
                    >
                      <p className="text-muted-foreground">{d.fullLabel}</p>
                      <p className="font-semibold text-foreground">{formatValue(d.value)}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* X axis */}
      <div className="ml-12 flex" aria-hidden>
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate pt-1.5 text-center text-[11px] text-muted-foreground">
            {d.label}
          </span>
        ))}
      </div>

      {/* Table view (screen readers): every value, not only the highlighted one. */}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.fullLabel}</th>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
