import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function ChatPage() {
  return (
    <>
      <PageHeader title="Chat" subtitle="Converse com o assistente de IA da clínica." />
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            A interface de chat com streaming (AI SDK ↔ NestJS) e o rail de tags chegam na{" "}
            <span className="font-medium text-foreground">Fase 1</span>.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
