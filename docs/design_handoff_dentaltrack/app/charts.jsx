/* charts.jsx — gráficos SVG leves e animados (substituem Recharts no protótipo) */

/* ---------- Sparkline ---------- */
function Sparkline({ data, w = 96, h = 32, color = "var(--primary)" }) {
  const max = Math.max(...data), min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = d + ` L${w} ${h} L0 ${h} Z`;
  const id = React.useMemo(() => "sp" + Math.random().toString(36).slice(2, 7), []);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.16" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Line chart (duas séries) ---------- */
function LineChart({ series, labels, height = 240 }) {
  const W = 760, H = height, padL = 36, padR = 12, padT = 14, padB = 26;
  const all = series.flatMap((s) => s.data);
  const max = Math.ceil(Math.max(...all) / 10) * 10, min = 0;
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i, n) => padL + (i / (n - 1)) * iw;
  const y = (v) => padT + ih - ((v - min) / (max - min)) * ih;
  const path = (data) => data.map((v, i) => (i ? "L" : "M") + x(i, data.length).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", overflow: "visible" }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (max / ticks) * (ticks - i);
        const yy = padT + (ih / ticks) * i;
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="var(--border)" strokeWidth="1" strokeDasharray={i === ticks ? "0" : "3 4"} />
            <text x={padL - 9} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)" className="tabular">{Math.round(v)}</text>
          </g>
        );
      })}
      {labels.map((l, i) => i % Math.ceil(labels.length / 6) === 0 && (
        <text key={i} x={x(i, labels.length)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{l}</text>
      ))}
      {series.map((s, si) => (
        <g key={si}>
          <path d={path(s.data)} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          {s.data.map((v, i) => (
            <circle key={i} cx={x(i, s.data.length)} cy={y(v)} r="2.6" fill={s.color} stroke="var(--card)" strokeWidth="1.4" />
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ---------- Funil de conversão ---------- */
function Funnel({ stages }) {
  const max = stages[0].value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stages.map((s, i) => {
        const pct = Math.round((s.value / max) * 100);
        return (
          <div key={s.label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</span>
              <span style={{ fontSize: 13, color: "var(--muted-foreground)" }} className="tabular">
                {s.value.toLocaleString("pt-BR")} <span style={{ opacity: .65 }}>· {pct}%</span>
              </span>
            </div>
            <div style={{ height: 32, background: "var(--muted)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: pct + "%", borderRadius: 8,
                background: `linear-gradient(90deg, var(--chart-1), color-mix(in oklab, var(--chart-1) 78%, white))`,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Barras horizontais (top tags) ---------- */
function HBars({ data }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.map((d, i) => (
        <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 116, flex: "none", display: "flex", justifyContent: "flex-end" }}><Tag name={d.label} /></div>
          <div style={{ flex: 1, height: 12, background: "var(--muted)", borderRadius: 999, overflow: "hidden" }}>
            <div className="bar-grow" style={{ height: "100%", width: (d.value / max) * 100 + "%", borderRadius: 999, background: d.color || "var(--chart-1)" }} />
          </div>
          <span className="tabular" style={{ width: 30, textAlign: "right", fontSize: 13, color: "var(--muted-foreground)" }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Donut (status) ---------- */
function Donut({ data, size = 168 }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const r = size / 2 - 16, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: "none" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth="16" />
        {data.map((d, i) => {
          const frac = d.value / total, len = frac * C, off = acc * C;
          acc += frac;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth="16" strokeLinecap="round"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off}
              transform={`rotate(-90 ${cx} ${cy})`} />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--foreground)" className="tabular">{total}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">conversas</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flex: "none" }} />
            <span style={{ fontSize: 13 }}>{d.label}</span>
            <span className="tabular" style={{ fontSize: 13, color: "var(--muted-foreground)", marginLeft: 4 }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Sparkline, LineChart, Funnel, HBars, Donut });
