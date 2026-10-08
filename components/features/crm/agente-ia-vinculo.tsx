"use client"

import { useTransition } from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import { setAgenteIaEntradaAction, setDepartamentoAgenteIaAction } from "@/app/actions/crm"
import { LinkButton } from "@/components/shared/link-button"
import { SelectField } from "@/components/shared/select-field"
import { Badge } from "@/components/ui/badge"
import type { AgenteIaOpcao } from "@/services/crm"

const NENHUM = "nenhum"

/**
 * Escolhe o agente de IA (plugin Agentes de IA) que responde as conversas de um escopo: o
 * departamento (`departamentoId`) ou, sem `departamentoId`, a entrada (quem ainda não está em
 * nenhum departamento). O agente só conversa; quando um humano assume a conversa ele para.
 */
export function AgenteIaVinculo({
  agentes,
  agenteId,
  departamentoId,
  podeAbrirAgentes,
}: {
  agentes: AgenteIaOpcao[]
  agenteId: string | null
  departamentoId: string | null
  /** Tem a seção Agentes de IA liberada: mostra o atalho para criar/editar agentes. */
  podeAbrirAgentes: boolean
}) {
  const [pending, startTransition] = useTransition()
  const atual = agentes.find((a) => a.id === agenteId) ?? null

  function alterar(valor: string) {
    const novo = valor === NENHUM ? null : valor
    startTransition(async () => {
      const resultado = departamentoId
        ? await setDepartamentoAgenteIaAction(departamentoId, novo)
        : await setAgenteIaEntradaAction(novo)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        Agente de IA
      </p>
      {agentes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum agente cadastrado.{" "}
          {podeAbrirAgentes ? "Crie um na tela Agentes de IA." : "Peça a quem tem acesso para criar um em Agentes de IA."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            value={agenteId ?? NENHUM}
            onValueChange={alterar}
            disabled={pending}
            size="sm"
            className="w-full sm:w-64"
            opcoes={[
              { value: NENHUM, label: "Nenhum agente" },
              ...agentes.map((a) => ({ value: a.id, label: a.ativo ? a.nome : `${a.nome} (desativado)` })),
            ]}
          />
          {atual && !atual.ativo ? <Badge variant="outline">Desativado: não responde até ser ativado</Badge> : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Responde as mensagens {departamentoId ? "deste departamento" : "de quem ainda não tem departamento"} enquanto nenhum humano assumir a
        conversa, e tem prioridade sobre o bot No Code do mesmo escopo.
      </p>
      {podeAbrirAgentes ? (
        <div>
          <LinkButton variant="outline" size="sm" href="/agentes-ia">
            Gerenciar agentes
          </LinkButton>
        </div>
      ) : null}
    </div>
  )
}
