/**
 * template.tsx re-monta a cada navegação → re-dispara a transição `fadeUp`
 * (motion do design). Conteúdo central com max-width 1240px e padding 28/32.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="anim-fade-up mx-auto w-full max-w-[1240px] px-8 pb-10 pt-7">{children}</div>
  );
}
