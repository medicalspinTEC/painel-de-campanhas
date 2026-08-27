import { InboundWebhookManager } from "@/components/features/integrations/inbound-webhook-manager"
import { WebhooksManager } from "@/components/features/integrations/webhooks-manager"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getToken, listEventos } from "@/services/inbound-webhook"
import { listWebhooks } from "@/services/webhooks"

export const metadata = {
  title: "Integrações | Painel de Campanhas WhatsApp",
}

const EXEMPLO_PAYLOAD = `POST /seu-endpoint
Content-Type: application/json
X-Webhook-Event: lead.atualizado
X-Webhook-Signature: sha256=<hmac do corpo com o secret>

{
  "evento": "lead.atualizado",
  "enviadoEm": "2026-07-29T13:40:12.000Z",
  "dados": { "leadId": "clx...", "nome": "Ana Paula Souza" }
}`

const EXEMPLO_INGESTAO = `POST /api/eventos
Content-Type: application/json
x-ingest-token: <INGEST_TOKEN>

{
  "kind": "enviada",        // enviada | falha | resposta
  "leadId": "clx...",
  "mensagemId": "clx...",
  "detalhes": "Texto da mensagem disparada."
}`

export default async function IntegracoesPage() {
  const [webhooks, tokenInicial, eventosIniciais] = await Promise.all([
    listWebhooks(),
    getToken(),
    listEventos(50),
  ])

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        titulo="Integrações"
        descricao="Conecte o painel a outros sistemas — envie eventos para fora com webhooks de saída ou receba eventos de sistemas externos pelo webhook de entrada."
      />

      <WebhooksManager webhooks={webhooks} />

      <InboundWebhookManager tokenInicial={tokenInicial} eventosIniciais={eventosIniciais} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Formato da entrega</CardTitle>
          <CardDescription>
            Cada evento gera um POST em JSON. O corpo é assinado com HMAC-SHA256 usando o secret do webhook, então
            valide o header antes de confiar no payload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {EXEMPLO_PAYLOAD}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quem dispara cada evento</CardTitle>
          <CardDescription>
            Os eventos de leads, campanhas e sistema saem automaticamente das ações do painel. Os de mensagem vêm da
            engine de disparo, que reporta cada envio neste endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {EXEMPLO_INGESTAO}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
