/* screen_chat.jsx — Chat do paciente ↔ agente de IA (com streaming + painel de tags) */

const BOT_REPLIES = {
  default: "Claro! Posso te ajudar com isso. Para entender melhor, você está com algum incômodo específico ou busca um procedimento estético? Assim já consigo te orientar e, se quiser, agendar uma avaliação.",
  agendar: "Perfeito! Vou organizar seu agendamento. Para qual procedimento você gostaria de marcar? E qual a melhor faixa de horário pra você — manhã ou tarde?",
  procedimentos: "Nós oferecemos diversos tratamentos. Os mais procurados são implante dentário, clareamento, facetas de porcelana e ortodontia. Sobre qual deles você gostaria de saber a descrição, a duração e a faixa de investimento?",
  implante: "O implante dentário repõe o dente perdido com uma raiz de titânio e uma coroa sobre ela. A avaliação inicial é fundamental para verificar o osso. Que tal agendarmos uma avaliação para um plano personalizado?",
};

function pickReply(text) {
  const t = text.toLowerCase();
  if (/agend|marc|consult|hor[aá]rio/.test(t)) return { key: "agendar", tags: ["agendamento"] };
  if (/implante/.test(t)) return { key: "implante", tags: ["implante"] };
  if (/procedi|tratam|servi|op[çc]/.test(t)) return { key: "procedimentos", tags: [] };
  if (/clarea/.test(t)) return { key: "default", tags: ["clareamento"] };
  if (/dor|urg/.test(t)) return { key: "default", tags: ["dor/urgência"] };
  return { key: "default", tags: [] };
}

function ChatScreen() {
  const [messages, setMessages] = React.useState([
    { role: "assistant", text: "Olá! Sou a Sofia, assistente virtual da Clínica Sorriso Pleno. Posso tirar dúvidas sobre procedimentos, recomendar o tratamento ideal e agendar sua avaliação. Como posso te ajudar hoje?" },
  ]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [detectedTags, setDetectedTags] = React.useState([
    { name: "avaliação", conf: 0.74 },
  ]);
  const scroller = React.useRef(null);

  React.useEffect(() => {
    if (scroller.current) scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const send = (textArg) => {
    const text = (textArg ?? input).trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    const { key, tags } = pickReply(text);
    setStreaming(true);

    setTimeout(() => {
      const full = BOT_REPLIES[key];
      setMessages((m) => [...m, { role: "assistant", text: "", streaming: true }]);
      let i = 0;
      const id = setInterval(() => {
        i += 2;
        setMessages((m) => {
          const c = [...m]; c[c.length - 1] = { role: "assistant", text: full.slice(0, i), streaming: i < full.length };
          return c;
        });
        if (i >= full.length) {
          clearInterval(id); setStreaming(false);
          if (tags.length) setDetectedTags((d) => {
            const names = new Set(d.map((x) => x.name));
            const add = tags.filter((t) => !names.has(t)).map((t) => ({ name: t, conf: 0.8 + Math.random() * 0.18 }));
            return [...d, ...add];
          });
        }
      }, 18);
    }, 650);
  };

  const quick = ["Quero agendar uma consulta", "Ver procedimentos", "Saber sobre implante", "Estou com dor"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 296px", gap: 18, height: "100%", minHeight: 0 }}>
      {/* Coluna do chat */}
      <Card style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        {/* Header do bot */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ position: "relative" }}>
            <span style={{ width: 42, height: 42, borderRadius: 12, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcRobot size={22} /></span>
            <span style={{ position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 999, background: "var(--success)", border: "2px solid var(--card)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Assistente · Clínica Sorriso Pleno</div>
            <div className="text-mut" style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--success)" }} /> Online · responde em segundos
            </div>
          </div>
          <span className="badge status-andamento"><span className="badge-dot" />Em andamento</span>
        </div>

        {/* Mensagens */}
        <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16, background: "linear-gradient(var(--background), var(--background))" }}>
          {messages.map((m, i) => <Bubble key={i} m={m} />)}
          {streaming && messages[messages.length - 1]?.role === "user" && <TypingBubble />}
        </div>

        {/* Quick replies */}
        {messages.length <= 2 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 20px 12px" }}>
            {quick.map((q) => (
              <button key={q} onClick={() => send(q)} className="anim-fade-up"
                style={{ fontFamily: "inherit", fontSize: 13, fontWeight: 500, color: "var(--primary)", background: "var(--primary-tint)", border: "1px solid transparent", padding: "8px 13px", borderRadius: 999, cursor: "pointer", transition: "background .16s, transform .12s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--primary-tint-strong)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--primary-tint)")}>
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", background: "var(--card)" }}>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <IconButton icon={IcPaperclip} variant="ghost" type="button" />
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Escreva sua mensagem…" rows={1}
              className="textarea" style={{ minHeight: 44, maxHeight: 120, padding: "11px 14px", flex: 1, resize: "none", borderRadius: 999 }} />
            <Button type="submit" className="btn-icon" disabled={!input.trim() || streaming} style={{ borderRadius: 999, opacity: !input.trim() || streaming ? 0.55 : 1 }}>
              <IcSend size={17} />
            </Button>
          </form>
          <div className="text-mut" style={{ fontSize: 11, marginTop: 8, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <IcSparkle size={12} /> Respostas geradas por IA · canal Web
          </div>
        </div>
      </Card>

      {/* Painel lateral de tags (admin/debug) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: 0, overflowY: "auto" }}>
        <Card className="card-pad">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <IcTag size={16} style={{ color: "var(--primary)" }} />
            <div className="h-section">Tags detectadas</div>
          </div>
          <div className="text-mut" style={{ fontSize: 12.5, marginBottom: 16 }}>Interesses classificados pela IA nesta conversa.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {detectedTags.map((t) => (
              <div key={t.name} className="anim-fade-up">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Tag name={t.name} />
                  <span className="tabular text-mut" style={{ fontSize: 12 }}>{Math.round(t.conf * 100)}%</span>
                </div>
                <div style={{ height: 6, background: "var(--muted)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: t.conf * 100 + "%", background: "var(--primary)", borderRadius: 999, transition: "width .6s cubic-bezier(.22,.61,.36,1)" }} />
                </div>
              </div>
            ))}
            {detectedTags.length === 0 && <div className="text-mut" style={{ fontSize: 13 }}>Nenhuma tag ainda.</div>}
          </div>
        </Card>

        <Card className="card-pad">
          <div className="h-section" style={{ marginBottom: 14 }}>Resumo da conversa</div>
          <SummaryRow icon={IcDot} label="Status" value={<StatusBadge status="andamento" />} />
          <div className="hr" style={{ margin: "12px 0" }} />
          <SummaryRow icon={IcMsg} label="Mensagens" value={<span className="tabular">{messages.length}</span>} />
          <div className="hr" style={{ margin: "12px 0" }} />
          <SummaryRow icon={IcClock} label="Início" value={<span className="text-mut">agora</span>} />
          <div className="hr" style={{ margin: "12px 0" }} />
          <SummaryRow icon={IcChat} label="Canal" value={<span className="badge badge-muted">Web</span>} />
        </Card>

        <Card className="card-pad" style={{ background: "var(--primary-tint)", border: "1px solid var(--primary-tint-strong)" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <IcSparkle size={18} style={{ color: "var(--primary)", flex: "none", marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--primary-active)" }}>Sugestão do agente</div>
              <div style={{ fontSize: 12.5, color: "var(--primary-active)", opacity: 0.85, marginTop: 4, lineHeight: 1.5 }}>
                Paciente com interesse inicial — conduza para a avaliação gratuita de junho.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Bubble({ m }) {
  const isUser = m.role === "user";
  return (
    <div className="anim-fade-up" style={{ display: "flex", gap: 10, justifyContent: isUser ? "flex-end" : "flex-start", alignItems: "flex-end" }}>
      {!isUser && <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><IcRobot size={16} /></span>}
      <div style={{
        maxWidth: "76%", padding: "11px 14px", fontSize: 14.5, lineHeight: 1.55,
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background: isUser ? "var(--primary)" : "var(--card)",
        color: isUser ? "#fff" : "var(--foreground)",
        border: isUser ? "0" : "1px solid var(--border)",
        boxShadow: "var(--shadow-xs)",
      }}>
        {m.text}{m.streaming && <span style={{ display: "inline-block", width: 7, height: 15, background: "var(--primary)", borderRadius: 2, marginLeft: 2, verticalAlign: "-2px", animation: "blink 1s infinite" }} />}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="anim-fade" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><IcRobot size={16} /></span>
      <div style={{ padding: "13px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px 16px 16px 4px", display: "flex", gap: 5 }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 7, borderRadius: 999, background: "var(--muted-foreground)", animation: `blink 1.2s ${i * 0.18}s infinite` }} />)}
      </div>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, color: "var(--muted-foreground)" }}><Icon size={15} />{label}</span>
      {value}
    </div>
  );
}

Object.assign(window, { ChatScreen });
