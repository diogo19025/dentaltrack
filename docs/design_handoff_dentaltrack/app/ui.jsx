/* ui.jsx — primitivas shadcn-like compartilhadas */

const cx = (...a) => a.filter(Boolean).join(" ");

function Button({ variant = "primary", size, icon: Icon, iconRight: IconR, className, children, ...p }) {
  return (
    <button className={cx("btn", `btn-${variant}`, size && `btn-${size}`, className)} {...p}>
      {Icon && <Icon />}{children}{IconR && <IconR />}
    </button>
  );
}

function IconButton({ icon: Icon, size = "sm", variant = "ghost", className, ...p }) {
  return (
    <button className={cx("btn", `btn-${variant}`, "btn-icon", size && `btn-${size}`, className)} {...p}>
      <Icon />
    </button>
  );
}

function Card({ className, hover, children, ...p }) {
  return <div className={cx("card", hover && "lift", className)} {...p}>{children}</div>;
}

function Field({ label, hint, children, htmlFor }) {
  return (
    <div>
      {label && <label className="field-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function Input({ icon: Icon, className, ...p }) {
  if (Icon) return (
    <div className="input-wrap"><Icon /><input className={cx("input", className)} {...p} /></div>
  );
  return <input className={cx("input", className)} {...p} />;
}

function Textarea({ className, ...p }) { return <textarea className={cx("textarea", className)} {...p} />; }

function Select({ className, children, ...p }) {
  return (
    <div style={{ position: "relative" }}>
      <select className={cx("select", className)} {...p}>{children}</select>
      <IcChevDown size={16} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-foreground)", pointerEvents: "none" }} />
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const lab = typeof o === "string" ? o : o.label;
        return (
          <button key={val} role="tab" data-active={value === val} onClick={() => onChange(val)}>{lab}</button>
        );
      })}
    </div>
  );
}

function Switch({ checked, onChange }) {
  return <button className="switch" data-on={!!checked} onClick={() => onChange(!checked)} aria-pressed={!!checked} />;
}

function Avatar({ name = "", src, size = 36, style }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, ...style }}>
      {src ? <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
    </div>
  );
}

const TAG_CLASS = {
  implante: "tag-teal", "faceta de porcelana": "tag-violet", faceta: "tag-violet",
  clareamento: "tag-amber", ortodontia: "tag-blue", "dor/urgência": "tag-rose",
  urgência: "tag-rose", limpeza: "tag-sage", canal: "tag-rose", protese: "tag-blue",
  "prótese": "tag-blue", estética: "tag-violet", avaliação: "tag-teal",
};
function tagClass(name) { return TAG_CLASS[name?.toLowerCase()] || "tag-teal"; }

function Tag({ name, color, dot = true }) {
  return (
    <span className={cx("tag", color || tagClass(name))}>
      {dot && <span className="tag-d" />}{name}
    </span>
  );
}

const STATUS_LABEL = { andamento: "Em andamento", agendada: "Agendada", abandonada: "Abandonada" };
function StatusBadge({ status }) {
  return (
    <span className={cx("badge", `status-${status}`)}>
      <span className="badge-dot" />{STATUS_LABEL[status] || status}
    </span>
  );
}

function Skeleton({ w = "100%", h = 14, r = 6, style }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: "linear-gradient(90deg,#eef3f2 25%,#e3ebea 37%,#eef3f2 63%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite", ...style }} />;
}

function Tooltip({ label, children }) {
  const [show, setShow] = React.useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="anim-fade" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#1a2b2c", color: "#fff", fontSize: 12, padding: "6px 9px", borderRadius: 7, whiteSpace: "nowrap", boxShadow: "var(--shadow-md)", zIndex: 50 }}>{label}</span>
      )}
    </span>
  );
}

Object.assign(window, { cx, Button, IconButton, Card, Field, Input, Textarea, Select, Segmented, Switch, Avatar, Tag, tagClass, StatusBadge, Skeleton, Tooltip });
