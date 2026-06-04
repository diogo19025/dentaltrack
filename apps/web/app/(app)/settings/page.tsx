import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" subtitle="Defina como o assistente se comporta." />
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Identidade & Persona, Ofertas & Instruções e o Preview do bot chegam na{" "}
            <span className="font-medium text-foreground">Fase 2</span>.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
