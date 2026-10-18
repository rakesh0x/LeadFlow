/** small svg charts. no library — these shapes are simple enough to draw directly. */
import type { TrendPoint } from "@/lib/queries/analytics";

export function Sparkline({
  points,
  height = 34,
  stroke = "var(--accent)",
  fill = true,
}: {
  points: number[];
  height?: number;
  stroke?: string;
  fill?: boolean;
}) {
  if (points.length < 2) return <div style={{ height }} />;
  const width = 100;
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - (p / max) * (height - 3) - 1.5] as const);

  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gradientId = `spark-${stroke.replace(/[^a-z0-9]/gi, "")}-${points.length}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height }} aria-hidden>
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const SERIES = [
  { key: "acquired" as const, label: "acquired", color: "var(--accent)" },
  { key: "contacted" as const, label: "contacted", color: "var(--blue)" },
  { key: "replied" as const, label: "replied", color: "var(--green)" },
  { key: "converted" as const, label: "converted", color: "var(--amber)" },
];

export function TrendChart({ points, height = 150 }: { points: TrendPoint[]; height?: number }) {
  if (points.length < 2) {
    return <div className="flex h-[150px] items-center justify-center text-[12.5px] text-muted">not enough data yet</div>;
  }

  const padL = 26;
  const padB = 18;
  const padT = 8;
  const width = 640;
  const innerW = width - padL - 8;
  const innerH = height - padB - padT;
  const max = Math.max(1, ...points.flatMap((p) => [p.acquired, p.contacted, p.replied, p.converted]));
  const step = innerW / Math.max(1, points.length - 1);

  const x = (i: number) => padL + i * step;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }} className="overflow-visible">
        {gridLines.map((g) => {
          const gy = padT + innerH * g;
          return (
            <g key={g}>
              <line x1={padL} y1={gy} x2={width - 4} y2={gy} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 0 ? undefined : "3 4"} />
              <text x={padL - 6} y={gy + 3.5} textAnchor="end" fontSize="9.5" fill="var(--faint)" className="num">
                {Math.round(max * (1 - g))}
              </text>
            </g>
          );
        })}
        {SERIES.map((s) => {
          const path = points
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`)
            .join(" ");
          return <path key={s.key} d={path} fill="none" stroke={s.color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />;
        })}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 6) === 0 || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={height - 5} textAnchor="middle" fontSize="9.5" fill="var(--faint)">
              {new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  tone = "accent",
  right,
  href,
  className = "",
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  tone?: string;
  right?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12.5px] text-ink">{label}</span>
        <span className="shrink-0 text-[12px] num text-muted">
          {right ?? <span className="text-ink">{value}</span>}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </>
  );
  if (href) {
    return (
      <a href={href} className={`block transition-opacity hover:opacity-80 ${className}`}>
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function FunnelChart({ steps }: { steps: Array<{ key: string; label: string; count: number; rate: number }> }) {
  const top = steps[0]?.count ?? 0;
  return (
    <div className="space-y-2.5">
      {steps.map((step, i) => {
        const pct = top > 0 ? (step.count / top) * 100 : 0;
        const prev = steps[i - 1];
        const stepRate = prev && prev.count > 0 ? Math.round((step.count / prev.count) * 100) : 100;
        const opacity = Math.max(0.22, 1 - i * 0.11);
        return (
          <div key={step.key}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-ink">{step.label}</span>
              <span className="num text-muted">
                <span className="num text-ink">{step.count}</span>
                {i > 0 ? <span className="ml-1.5 text-faint">{stepRate}% of previous</span> : null}
              </span>
            </div>
            <div className="mt-1 h-7 overflow-hidden rounded-md bg-surface-2">
              <div
                className="flex h-full items-center rounded-md px-2 transition-[width] duration-500"
                style={{ width: `${Math.max(pct, 1.5)}%`, background: `color-mix(in srgb, var(--accent) ${Math.round(opacity * 100)}%, transparent)` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ segments, size = 108 }: { segments: Array<{ label: string; value: number; color: string }>; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="12" />
      {total > 0
        ? segments.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={`${s.label}-${i}`}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="12"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })
        : null}
    </svg>
  );
}