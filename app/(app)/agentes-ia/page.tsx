import { AgentesManager } from "@/components/features/agentes-ia/agentes-manager"
import { PageHeader } from "@/components/shared/page-header"
import { podeAcessar, temPoder } from "@/lib/permissoes"
import { requireSecao } from "@/lib/session"
import { listarAgentes } from "@/services/agentes-ia"
import { getCrmPluginAtivo } from "@/services/settings"

export const metadata = {
  title: "Agentes de IA | Painel de Campanhas WhatsApp",
}

export default async function AgentesIaPage() {
  // Plugin desativado = 404 (SECAO_PLUGIN em lib/plugins.ts).
  const usuario = await requireSecao("agentes_ia")
  const [agentes, crmAtivo] = await Promise.all([listarAgentes(), getCrmPluginAtivo()])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Agentes de IA"
        descricao="Agentes de atendimento com IA (Claude, Groq ou outra API compatível) que respondem as mensagens dos leads no WhatsApp. Informe a chave de API, escolha o modelo e escreva o prompt; depois vincule o agente a um departamento ou como agente de entrada na aba CRM."
      />
      <AgentesManager
        agentes={agentes}
        crmAtivo={crmAtivo}
        podeAbrirCrm={crmAtivo && temPoder(usuario, "crm_gerenciar") && podeAcessar(usuario, "agentes_ia")}
      />
    </div>
  )
}
