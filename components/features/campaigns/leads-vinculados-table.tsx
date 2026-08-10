"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { format } from "date-fns"
import { Clock, MoreHorizontal, Pencil, Zap } from "lucide-react"
import { toast } from "sonner"

import { ajustarTimingLeadsAction, venceProximaMensagemAction } from "@/app/actions/leads"
import { LeadStatusBadge } from "@/components/shared/status-badges"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calcularProximaMensagem, formatarTempoAte, type ScheduleCampaign } from "@/lib/campaign-schedule"
import { formatDate } from "@/lib/format"
import type { LeadRow } from "@/services/leads"

interface CampanhaCronograma extends ScheduleCampaign {
  id: string
}

/** Converte um ISO em valor aceito por <input type="datetime-local"> (hora local). */
function isoParaInputLocal(iso: string | null): string {
  if (!iso) return ""
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ""
  return format(data, "yyyy-MM-dd'T'HH:mm")
}

/** Converte o valor do input local de volta para ISO (UTC). */
function inputLocalParaIso(valor: string): string | undefined {
  if (!valor) return undefined
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return undefined
  return data.toISOString()
}

interface EdicaoState {
  aberto: boolean
  leadIds: string[]
  titulo: string
  entrada: string
  ultimo: string
}

const EDICAO_FECHADA: EdicaoState = { aberto: false, leadIds: [], titulo: "", entrada: "", ultimo: "" }

export function LeadsVinculadosTable({
  leads,
  campanha,
}: {
  leads: LeadRow[]
  campanha: CampanhaCronograma
}) {
  const router = useRouter()
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [edicao, setEdicao] = useState<EdicaoState>(EDICAO_FECHADA)
  const [pending, startTransition] = useTransition()

  const todosSelecionados = leads.length > 0 && leads.every((l) => selecionados.includes(l.id))
  const algumSelecionado = selecionados.length > 0

  const proximas = useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof calcularProximaMensagem>>()
    for (const lead of leads) {
      mapa.set(lead.id, calcularProximaMensagem(lead.entradaCampanhaEm, lead.ultimoContato, campanha))
    }
    return mapa
  }, [leads, campanha])

  function alternarTodos(checked: boolean) {
    setSelecionados(checked ? leads.map((l) => l.id) : [])
  }

  function alternarLead(id: string, checked: boolean) {
    setSelecionados((atual) => (checked ? [...atual, id] : atual.filter((v) => v !== id)))
  }

  function abrirEdicaoLead(lead: LeadRow) {
    setEdicao({
      aberto: true,
      leadIds: [lead.id],
      titulo: `Ajustar tempos de ${lead.nome}`,
      entrada: isoParaInputLocal(lead.entradaCampanhaEm),
      ultimo: isoParaInputLocal(lead.ultimoContato),
    })
  }

  function abrirEdicaoEmMassa() {
    setEdicao({
      aberto: true,
      leadIds: [...selecionados],
      titulo: `Ajustar tempos de ${selecionados.length} lead(s)`,
      entrada: "",
      ultimo: "",
    })
  }

  function salvarEdicao() {
    const { leadIds, entrada, ultimo } = edicao
    startTransition(async () => {
      const res = await ajustarTimingLeadsAction(leadIds, campanha.id, {
        entradaCampanhaEm: inputLocalParaIso(entrada),
        ultimoContato: inputLocalParaIso(ultimo),
      })
      if (res.ok) {
        toast.success(res.message)
        setEdicao(EDICAO_FECHADA)
        setSelecionados([])
        router.refresh()
      } else {
        toast.error(res.message)
      }
    })
  }

  function vencerAgora(leadIds: string[]) {
    startTransition(async () => {
      const res = await venceProximaMensagemAction(leadIds, campanha.id)
      if (res.ok) {
        toast.success(res.message)
        setSelecionados([])
        router.refresh()
      } else {
        toast.error(res.message)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {algumSelecionado ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">{selecionados.length} lead(s) selecionado(s)</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={abrirEdicaoEmMassa} disabled={pending}>
              <Pencil className="size-4" />
              Editar tempos
            </Button>
            <Button size="sm" onClick={() => vencerAgora(selecionados)} disabled={pending}>
              {pending ? <Spinner /> : <Zap className="size-4" />}
              Vencer agora
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelecionados([])} disabled={pending}>
              Limpar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={todosSelecionados}
                  onCheckedChange={(checked) => alternarTodos(Boolean(checked))}
                  aria-label="Selecionar todos os leads"
                />
              </TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Mensagens</TableHead>
              <TableHead className="text-right">Próxima mensagem</TableHead>
              <TableHead className="text-right">Último contato</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const proxima = proximas.get(lead.id) ?? null
              return (
                <TableRow key={lead.id} data-state={selecionados.includes(lead.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selecionados.includes(lead.id)}
                      onCheckedChange={(checked) => alternarLead(lead.id, Boolean(checked))}
                      aria-label={`Selecionar ${lead.nome}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.nome}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lead.produto}</TableCell>
                  <TableCell>
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{lead.mensagensEnviadas}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={proxima?.vencida ? "font-medium text-primary" : "text-muted-foreground"}>
                      {formatarTempoAte(proxima)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {lead.ultimoContato ? formatDate(lead.ultimoContato) : "—"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${lead.nome}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{lead.nome}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => vencerAgora([lead.id])}>
                          <Zap className="size-4" />
                          Vencer agora
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => abrirEdicaoLead(lead)}>
                          <Pencil className="size-4" />
                          Editar tempos
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={edicao.aberto} onOpenChange={(aberto) => !aberto && setEdicao(EDICAO_FECHADA)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{edicao.titulo}</DialogTitle>
            <DialogDescription>
              Ajuste os marcos de tempo do lead para testar a sequência sem esperar o horário programado.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="ajuste-entrada">Entrada na campanha</FieldLabel>
              <Input
                id="ajuste-entrada"
                type="datetime-local"
                value={edicao.entrada}
                onChange={(e) => setEdicao((atual) => ({ ...atual, entrada: e.target.value }))}
              />
              <FieldDescription>
                Âncora do cronograma. Recuar esta data adianta a próxima mensagem.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="ajuste-ultimo">Último contato</FieldLabel>
              <Input
                id="ajuste-ultimo"
                type="datetime-local"
                value={edicao.ultimo}
                onChange={(e) => setEdicao((atual) => ({ ...atual, ultimo: e.target.value }))}
              />
              <FieldDescription>
                Data da última mensagem enviada. Mensagens agendadas após ela ficam pendentes.
              </FieldDescription>
            </Field>

            {edicao.leadIds.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                Os valores serão aplicados aos {edicao.leadIds.length} leads selecionados. Campos em branco são ignorados.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => vencerAgora(edicao.leadIds)}
              disabled={pending || edicao.leadIds.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/8 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
            >
              <Clock className="size-4" />
              Vencer a próxima mensagem agora
            </button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEdicao(EDICAO_FECHADA)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={salvarEdicao} disabled={pending}>
              {pending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
