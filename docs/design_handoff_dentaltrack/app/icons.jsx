/* icons.jsx — ícones lucide-style + logo DentalTrack (símbolo de dente) */

const I = ({ d, size = 18, sw = 1.8, fill = "none", children, ...p }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

/* Símbolo de dente (molar estilizado, traço limpo) */
const ToothMark = ({ size = 22, sw = 1.8, ...p }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 5.5c-1.7-1.6-3.7-2.2-5.2-1.3C5 5.3 4.4 7.6 4.9 10.2c.3 1.5.4 2.4.5 3.8.2 2.3.4 4 .9 5.4.3.9.8 1.6 1.4 1.6.8 0 1-1 1.3-2.5.3-1.4.6-2.6 1.6-2.6h.8c1 0 1.3 1.2 1.6 2.6.3 1.5.5 2.5 1.3 2.5.6 0 1.1-.7 1.4-1.6.5-1.4.7-3.1.9-5.4.1-1.4.2-2.3.5-3.8.5-2.6-.1-4.9-1.9-6C15.7 3.3 13.7 3.9 12 5.5Z" />
  </svg>
);

/* Logo completo: marca + wordmark */
const Logo = ({ compact = false, mark = 30, font = 18 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
    <span style={{
      width: mark + 12, height: mark + 12, borderRadius: 11,
      background: "var(--primary)", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "var(--shadow-sm)", flex: "none"
    }}>
      <ToothMark size={mark} sw={1.9} fill="rgba(255,255,255,0.08)" />
    </span>
    {!compact && (
      <span style={{ fontWeight: 600, fontSize: font, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
        Dental<span style={{ color: "var(--primary)" }}>Track</span>
      </span>
    )}
  </div>
);

/* Ícones de navegação e UI */
const IcChat     = (p) => <I {...p} d="M7.9 20A9 9 0 1 0 4 16.1L3 21l4.9-1Z" />;
const IcDash     = (p) => <I {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></I>;
const IcLeads    = (p) => <I {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></I>;
const IcSettings = (p) => <I {...p}><path d="M12.2 2h-.4a2 2 0 0 0-2 2 1.7 1.7 0 0 1-2.6 1.5 2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7A1.7 1.7 0 0 1 4 12a1.7 1.7 0 0 1-1 1.5 2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7A1.7 1.7 0 0 1 7.8 20a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2 1.7 1.7 0 0 1 2.6-1.5 2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7A1.7 1.7 0 0 1 20 12a1.7 1.7 0 0 1 1-1.5 2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7A1.7 1.7 0 0 1 16.2 4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></I>;
const IcSend     = (p) => <I {...p}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></I>;
const IcSearch   = (p) => <I {...p}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></I>;
const IcBell     = (p) => <I {...p}><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M21 16c-1.5-2-2-3-2-6 0-3.9-3.1-7-7-7s-7 3.1-7 7c0 3-.5 4-2 6Z"/></I>;
const IcChevDown = (p) => <I {...p} d="m6 9 6 6 6-6" />;
const IcChevRight= (p) => <I {...p} d="m9 6 6 6-6 6" />;
const IcArrowUp  = (p) => <I {...p}><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></I>;
const IcArrowDn  = (p) => <I {...p}><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></I>;
const IcPlus     = (p) => <I {...p} d="M5 12h14M12 5v14" />;
const IcCheck    = (p) => <I {...p} d="M20 6 9 17l-5-5" />;
const IcX        = (p) => <I {...p} d="M18 6 6 18M6 6l12 12" />;
const IcMail     = (p) => <I {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></I>;
const IcLock     = (p) => <I {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></I>;
const IcEye      = (p) => <I {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></I>;
const IcEyeOff   = (p) => <I {...p}><path d="M9.9 4.2A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.2 3"/><path d="M6.6 6.6A13.4 13.4 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.4-1.1"/><path d="M3 3l18 18"/></I>;
const IcPhone    = (p) => <I {...p} d="M13.8 10.2a8 8 0 0 0 3.5 3.5l1.2-1.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.5.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A18 18 0 0 1 3 6a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1c0 1.2.2 2.4.57 3.5a1 1 0 0 1-.25 1Z" />;
const IcLogout   = (p) => <I {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></I>;
const IcSparkle  = (p) => <I {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></I>;
const IcRobot    = (p) => <I {...p}><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 4h6"/><circle cx="9" cy="13.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none"/><path d="M2 13v2M22 13v2"/></I>;
const IcCalendar = (p) => <I {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></I>;
const IcClock    = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></I>;
const IcTrend    = (p) => <I {...p}><path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/></I>;
const IcUsers    = IcLeads;
const IcMsg      = IcChat;
const IcTag      = (p) => <I {...p}><path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none"/></I>;
const IcTarget   = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></I>;
const IcInbox    = (p) => <I {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1Z"/></I>;
const IcUpload   = (p) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/></I>;
const IcPaperclip= (p) => <I {...p} d="M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.2-9.2a3.33 3.33 0 0 1 4.71 4.71l-9.2 9.2a1.67 1.67 0 0 1-2.36-2.36l8.49-8.48" />;
const IcInfo     = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></I>;
const IcFilter   = (p) => <I {...p} d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />;
const IcDownload = (p) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></I>;
const IcMore     = (p) => <I {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></I>;
const IcDot      = (p) => <I {...p}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></I>;
const IcMenu     = (p) => <I {...p} d="M3 6h18M3 12h18M3 18h18" />;
const IcRefresh  = (p) => <I {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></I>;
const IcStetho   = (p) => <I {...p}><path d="M4 3v6a5 5 0 0 0 10 0V3"/><path d="M4 3H2M14 3h-2M9 14v3a4 4 0 0 0 8 0v-1"/><circle cx="19" cy="13" r="2"/></I>;

Object.assign(window, {
  ToothMark, Logo,
  IcChat, IcDash, IcLeads, IcSettings, IcSend, IcSearch, IcBell, IcChevDown, IcChevRight,
  IcArrowUp, IcArrowDn, IcPlus, IcCheck, IcX, IcMail, IcLock, IcEye, IcEyeOff, IcPhone,
  IcLogout, IcSparkle, IcRobot, IcCalendar, IcClock, IcTrend, IcUsers, IcMsg, IcTag,
  IcTarget, IcInbox, IcUpload, IcPaperclip, IcInfo, IcFilter, IcDownload, IcMore, IcDot,
  IcMenu, IcRefresh, IcStetho,
});
