"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundCheck,
} from "lucide-react"
import { toast } from "sonner"

import { assignCampaignAction, deleteLeadAction, setLeadStatusAction } from "@/app/actions/leads"
import { LeadFormDialog, type CampanhaOpcao } from "@/components/features/leads/lead-form-dialog"
import { SelectField, opcoesDe } from "@/components/shared/select-field"
import { LeadStatusBadge } from "@/components/shared/status-badges"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatNumber, formatRelative } from "@/lib/format"
import type { LeadRow } from "@/services/leads"
import { LEAD_STATUS_LABEL, MARCAS, PRODUTOS, REGIOES, type LeadStatus } from "@/types"

const TODOS = "todos"
const POR_PAGINA = 12

const OPCOES_STATUS = [
  { value: TODOS, label: "Todos os status" },
  ...(Object.keys(LEAD_STATUS_LABEL) as LeadStatus[]).map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] })),
]

export function LeadsTable({ leads, campanhas }: { leads: LeadRow[]; campanhas: CampanhaOpcao[] }) {
  const [busca, setBusca] = useState("")
  const [status, setStatus] = useState(TODOS)
  const [produto, setProduto] = useState(TODOS)
  const [marca, setMarca] = useState(TODOS)
  const [regiao, setRegiao] = useState(TODOS)
  const [campanhaFiltro, setCampanhaFiltro] = useState(TODOS)
  const [pagina, setPagina] = useState(1)
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [formAberto, setFormAberto] = useState(false)
  const [leadEditando, setLeadEditando] = useState<LeadRow | null>(null)
  const [leadExcluindo, setLeadExcluindo] = useState<LeadRow | null>(null)
  const [pending, startTransition] = useTransition()

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return leads.filter((lead) => {
      if (termo && !`${lead.nome} ${lead.telefone}`.toLowerCase().includes(termo)) return false
      if (status !== TODOS && lead.status !== status) return false
      if (produto !== TODOS && lead.produto !== produto) return false
      if (marca !== TODOS && lead.marca !== marca) return false
      if (regiao !== TODOS && lead.regiao !== regiao) return false
      if (campanhaFiltro === "sem" && lead.campanhasIds.length > 0) return false
      if (campanhaFiltro !== TODOS && campanhaFiltro !== "sem" && !lead.campanhasIds.includes(campanhaFiltro)) return false
      return true
    })
  }, [leads, busca, status, produto, marca, regiao, campanhaFiltro])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const visiveis = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)
  const todosSelecionados = visiveis.length > 0 && visiveis.every((l) => selecionados.includes(l.id))

  function resetPagina<T>(setter: (v: T) => void) {
    return (valor: T) => {
      setter(valor)
      setPagina(1)
      setSelecionados([])
    }
  }

  function alternarTodos(checked: boolean) {
    setSelecionados(checked ? visiveis.map((l) => l.id) : [])
  }

  function alternarLead(id: string, checked: boolean) {
    setSelecionados((atual) => (checked ? [...atual, id] : atual.filter((v) => v !== id)))
  }

  function moverParaCampanha(campanhaId: string) {
    const alvo = campanhaId === "none" ? null : campanhaId
    startTransition(async () => {
      const res = await assignCampaignAction(selecionados, alvo)
      toast.success(res.message)
      setSelecionados([])
    })
  }

  function qualificar(lead: LeadRow) {
    startTransition(async () => {
      await setLeadStatusAction(lead.id, "qualificado")
      toast.success(`${lead.nome} marcado como qualificado.`)
    })
  }

  function excluir() {
    if (!leadExcluindo) return
    const alvo = leadExcluindo
    startTransition(async () => {
      await deleteLeadAction(alvo.id)
      toast.success(`Lead ${alvo.nome} excluído.`)
      setLeadExcluindo(null)
    })
  }

  const opcoesCampanhaFiltro = [
    { value: TODOS, label: "Todas as campanhas" },
    { value: "sem", label: "Sem campanha" },
    ...campanhas.map((c) => ({ value: c.id, label: c.nome })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 px-4">
          {/*
            A barra volta a ficar lado a lado já no `sm`: o campo de busca e o
            botão cabem juntos muito antes de `lg`, que deixava o botão
            esticado em largura total mesmo em telas largas.
          */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={busca}
                onChange={(e) => resetPagina(setBusca)(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="pl-8"
                aria-label="Buscar leads"
              />
            </div>
            <Button onClick={() => { setLeadEditando(null); setFormAberto(true) }} className="sm:w-auto">
              <Plus className="size-4" />
              Novo lead
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            <SelectField
              value={status}
              onValueChange={resetPagina(setStatus)}
              opcoes={OPCOES_STATUS}
              className="w-full"
            />
            <SelectField
              value={produto}
              onValueChange={resetPagina(setProduto)}
              opcoes={[{ value: TODOS, label: "Todos os produtos" }, ...opcoesDe(PRODUTOS)]}
              className="w-full"
            />
            <SelectField
              value={marca}
              onValueChange={resetPagina(setMarca)}
              opcoes={[{ value: TODOS, label: "Todas as marcas" }, ...opcoesDe(MARCAS)]}
              className="w-full"
            />
            <SelectField
              value={regiao}
              onValueChange={resetPagina(setRegiao)}
              opcoes={[{ value: TODOS, label: "Todas as regiões" }, ...opcoesDe(REGIOES)]}
              className="w-full"
            />
            <SelectField
              value={campanhaFiltro}
              onValueChange={resetPagina(setCampanhaFiltro)}
              opcoes={opcoesCampanhaFiltro}
              className="w-full"
            />
          </div>
        </CardContent>
      </Card>

      {selecionados.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">
            {formatNumber(selecionados.length)} lead(s) selecionado(s)
          </p>
          <div className="flex items-center gap-2">
            <SelectField
              value=""
              onValueChange={moverParaCampanha}
              opcoes={[{ value: "none", label: "Remover da campanha" }, ...campanhas.map((c) => ({ value: c.id, label: c.nome }))]}
              placeholder="Mover para campanha"
              size="sm"
              className="w-56"
            />
            <Button variant="ghost" size="sm" onClick={() => setSelecionados([])} disabled={pending}>
              Limpar
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={todosSelecionados}
                    onCheckedChange={(checked) => alternarTodos(Boolean(checked))}
                    aria-label="Selecionar todos os leads da página"
                  />
                </TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="hidden md:table-cell">Produto / Marca</TableHead>
                <TableHead className="hidden lg:table-cell">Persona / Região</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead className="hidden xl:table-cell">Interações</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden xl:table-cell">Último contato</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((lead) => (
                <TableRow key={lead.id} data-state={selecionados.includes(lead.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selecionados.includes(lead.id)}
                      onCheckedChange={(checked) => alternarLead(lead.id, Boolean(checked))}
                      aria-label={`Selecionar ${lead.nome}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="flex flex-col gap-0.5 hover:underline">
                      <span className="font-medium">{lead.nome}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{lead.telefone}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">{lead.produto}</span>
                      <span className="text-xs text-muted-foreground">{lead.marca}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">{lead.persona}</span>
                      <span className="text-xs text-muted-foreground">{lead.regiao}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {lead.campanhasNomes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {lead.campanhasNomes.map((nome) => (
                          <Badge key={nome} variant="secondary" className="text-xs">
                            {nome}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {lead.mensagensEnviadas} env. · {lead.respostas} resp.
                    </span>
                  </TableCell>
                  <TableCell>
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {lead.ultimoContato ? formatRelative(lead.ultimoContato) : "Sem contato"}
                    </span>
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
                        <DropdownMenuItem nativeButton={false} render={<Link href={`/leads/${lead.id}`} />}>
                          Ver histórico
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setLeadEditando(lead)
                            setFormAberto(true)
                          }}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => qualificar(lead)} disabled={lead.status === "qualificado"}>
                          <UserRoundCheck className="size-4" />
                          Marcar como qualificado
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setLeadExcluindo(lead)}>
                          <Trash2 className="size-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {visiveis.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>Nenhum lead encontrado</EmptyTitle>
              <EmptyDescription>Ajuste os filtros ou cadastre um novo lead para começar.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </Card>

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {formatNumber(filtrados.length)} de {formatNumber(leads.length)} leads
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaAtual === 1}
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {paginaAtual} / {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaAtual === totalPaginas}
          >
            Próxima
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <LeadFormDialog
        key={leadEditando?.id ?? "novo"}
        open={formAberto}
        onOpenChange={setFormAberto}
        lead={leadEditando}
        campanhas={campanhas}
      />

      <AlertDialog open={Boolean(leadExcluindo)} onOpenChange={(aberto) => !aberto && setLeadExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {leadExcluindo?.nome} e todo o histórico de eventos serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={excluir} disabled={pending}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
