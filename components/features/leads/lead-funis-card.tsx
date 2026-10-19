"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { definirValorFunilAction, moverLeadNoFunilAction, removerLeadDoFunilAction } from "@/app/actions/funis"
import { FunilAdicionarLeadsDialog } from "@/components/features/crm/funil-adicionar-leads-dialog"
import { SelectField } from "@/components/shared/select-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { FUNIL_COR_ESTILOS, FUNIL_TIPO_ROTULO, formatarValorFunil, lerValorFunil } from "@/lib/funis"
import { formatDateTime, formatRelative } from "@/lib/format"
import type { LeadFunilMovimentoItem, LeadFunilVinculo } from "@/services/funis"

/** Funis de vendas do lead (tela de detalhe): ver a etapa, mover, definir o valor, sair do funil ou entrar em outro. */
export function LeadFunisCard({
  leadId,
  leadNome,
  vinculos,
  movimentos,
}: {
  leadId: string
  leadNome: string
  vinculos: LeadFunilVinculo[]
  movimentos: LeadFunilMovimentoItem[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [adicionarAberto, setAdicionarAberto] = useState(false)
  const [editandoValor, setEditandoValor] = useState<string | null>(null)
  const [valorTexto, setValorTexto] = useState("")

  function executar(funilId: string, acao: () => Promise<{ ok: boolean; message: string }>, aposSucesso?: () => void) {
    setOcupado(funilId)
    startTransition(async () => {
      const res = await acao()
      setOcupado(null)
      if (!res.ok) return void toast.error(res.message)
      toast.success(res.message)
      aposSucesso?.()
      router.refresh()
    })
  }

  function salvarValor(funilId: string) {
    const numero = lerValorFunil(valorTexto)
    if (Number.isNaN(numero)) return void toast.error("Informe um valor válido.")
    executar(funilId, () => definirValorFunilAction(funilId, leadId, numero), () => setEditandoValor(null))
  }

  return (
    <div className="flex flex-col gap-4">
      {vinculos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este lead não está em nenhum funil de vendas.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {vinculos.map((v) => {
            const etapa = v.etapas.find((e) => e.id === v.etapaId)
            const trabalhando = ocupado === v.funilId && pending
            return (
              <li key={v.funilId} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{v.funilNome}</span>
                    {!v.funilAtivo ? <Badge variant="secondary">Inativo</Badge> : null}
                    {etapa && etapa.tipo !== "aberta" ? <Badge variant="outline">{FUNIL_TIPO_ROTULO[etapa.tipo]}</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">Na etapa desde {formatRelative(v.movidoEm)}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`size-2.5 shrink-0 rounded-full ${etapa ? FUNIL_COR_ESTILOS[etapa.cor].ponto : "bg-zinc-500"}`} aria-hidden />
                  <SelectField
                    value={v.etapaId}
                    onValueChange={(etapaId) => etapaId !== v.etapaId && executar(v.funilId, () => moverLeadNoFunilAction(v.funilId, leadId, etapaId))}
                    opcoes={v.etapas.map((e) => ({ value: e.id, label: e.nome }))}
                    size="sm"
                    className="w-48"
                    disabled={!v.funilAtivo || trabalhando}
                  />
                  {trabalhando ? <Spinner className="size-4" /> : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    disabled={trabalhando}
                    onClick={() => executar(v.funilId, () => removerLeadDoFunilAction(v.funilId, leadId))}
                  >
                    <Trash2 className="size-4" />
                    Remover
                  </Button>
                </div>

                {editandoValor === v.funilId ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={valorTexto}
                      onChange={(e) => setValorTexto(e.target.value)}
                      inputMode="decimal"
                      placeholder="R$ 0,00"
                      aria-label={`Valor no funil ${v.funilNome}`}
                      className="w-40"
                      autoFocus
                    />
                    <Button type="button" size="sm" disabled={trabalhando} onClick={() => salvarValor(v.funilId)}>
                      Salvar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditandoValor(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Valor estimado:</span>
                    <span className="font-medium tabular-nums">{v.valor === null ? "—" : formatarValorFunil(v.valor)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Alterar valor no funil ${v.funilNome}`}
                      onClick={() => {
                        setValorTexto(v.valor === null ? "" : String(v.valor).replace(".", ","))
                        setEditandoValor(v.funilId)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="self-start" onClick={() => setAdicionarAberto(true)}>
        <Plus className="size-4" />
        Adicionar a um funil
      </Button>

      {movimentos.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">Últimos movimentos</span>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {movimentos.map((m) => (
              <li key={m.id}>
                <span className="font-medium text-foreground">{m.funil}</span>:{" "}
                {m.deEtapa === null ? `entrou em ${m.paraEtapa}` : m.paraEtapa === null ? `saiu de ${m.deEtapa}` : `${m.deEtapa} → ${m.paraEtapa}`} · {m.porUsuario} ·{" "}
                {formatDateTime(m.data)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FunilAdicionarLeadsDialog
        open={adicionarAberto}
        onOpenChange={setAdicionarAberto}
        leadIds={[leadId]}
        descricao={`Escolha o funil e a etapa em que ${leadNome} vai entrar.`}
        excluirFunilIds={vinculos.map((v) => v.funilId)}
        onAdicionado={() => router.refresh()}
      />
    </div>
  )
}
