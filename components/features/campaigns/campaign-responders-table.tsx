"use client"

import Link from "next/link"
import { MessageCircleReply } from "lucide-react"
import { useMemo, useState } from "react"
import { LeadStatusBadge } from "@/components/shared/status-badges"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format"
import type { CampaignResponder } from "@/services/campaigns"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

const TAMANHOS_PAGINA = [10, 25, 50, 100] as const
/**
 * Uma linha por lead que já respondeu a esta campanha (agregado a partir dos
 * eventos de resposta). Diferente da seção "Respostas recebidas" — que lista
 * cada evento de resposta em ordem cronológica —, aqui cada lead aparece uma
 * única vez, com o status atual dele e quando respondeu pela última vez.
 */


export function CampaignRespondersTable({ 
  leads 
}: { 
  leads: CampaignResponder[] 
}) {
  const [tamanhoPagina, setTamanhoPagina] = useState<(typeof TAMANHOS_PAGINA)[number]>(10)
  const [pagina, setPagina] = useState(1)

  const totalPaginas = Math.max(1, Math.ceil(leads.length / tamanhoPagina))
  // Corrige a página atual se a lista encolheu (ex.: após um filtro) e ela
  // ficou fora do intervalo válido, sem esperar por um novo render disparado
  // pelo usuário.
  const paginaAtual = Math.min(pagina, totalPaginas)
  const leadsDaPagina = useMemo(() => {
    const inicio = (paginaAtual - 1) * tamanhoPagina
    return leads.slice(inicio, inicio + tamanhoPagina)
  }, [leads, paginaAtual, tamanhoPagina])

  if (leads.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleReply />
          </EmptyMedia>
          <EmptyTitle>Nenhum lead respondeu ainda</EmptyTitle>
          <EmptyDescription>
            Assim que um lead responder, ele sai da sequência e passa a aparecer aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead className="hidden sm:table-cell">Telefone</TableHead>
            <TableHead>Status atual</TableHead>
            <TableHead className="text-right">Respostas</TableHead>
            <TableHead className="text-right">Última resposta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leadsDaPagina.map((lead) => (
            <TableRow key={lead.leadId}>
              <TableCell>
                {lead.leadNome === "Lead removido" ? (
                  <span className="text-muted-foreground">{lead.leadNome}</span>
                ) : (
                  <Link href={`/leads/${lead.leadId}`} className="font-medium hover:underline">
                    {lead.leadNome}
                  </Link>
                )}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground tabular-nums sm:table-cell">
                {lead.leadTelefone || "—"}
              </TableCell>
              <TableCell>
                <LeadStatusBadge status={lead.leadStatus} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(lead.totalRespostas)}</TableCell>
              <TableCell className="text-right text-muted-foreground" title={formatDateTime(lead.ultimaRespostaEm)}>
                {formatRelative(lead.ultimaRespostaEm)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-col-reverse items-center justify-between gap-3 pt-4 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Por página</span>
          <Select
            value={String(tamanhoPagina)}
            onValueChange={(valor) => {
              setTamanhoPagina(Number(valor) as (typeof TAMANHOS_PAGINA)[number])
              setPagina(1)
            }}
          >
            <SelectTrigger className="h-8 w-[72px]" aria-label="Leads por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAMANHOS_PAGINA.map((tamanho) => (
                <SelectItem key={tamanho} value={String(tamanho)}>
                  {tamanho}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>
            {leads.length === 0
              ? "0 leads"
              : `${(paginaAtual - 1) * tamanhoPagina + 1}–${Math.min(paginaAtual * tamanhoPagina, leads.length)} de ${leads.length} leads`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaAtual <= 1}
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            Página {paginaAtual} de {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaAtual >= totalPaginas}
          >
            Próxima
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
