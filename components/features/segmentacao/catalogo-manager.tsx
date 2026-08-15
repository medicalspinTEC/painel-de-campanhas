"use client"

import { useMemo, useState, useTransition } from "react"
import { Pencil, Plus, Search, Trash2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { CatalogoFormDialog } from "@/components/features/segmentacao/catalogo-form-dialog"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatNumber } from "@/lib/format"
import type { CatalogoActionResult } from "@/app/actions/catalogo-segmentacao"
import type { ItemCatalogo, ItemCatalogoInput } from "@/services/catalogo-segmentacao"

/** Textos e ações que diferenciam cada catálogo (marca, persona, região). */
export interface CatalogoConfig {
  /** Rótulo singular minúsculo, ex.: "marca". */
  singular: string
  /** Rótulo plural minúsculo, ex.: "marcas". */
  plural: string
  /** Título do card (capitalizado), ex.: "Marcas". */
  titulo: string
  /** Placeholder de exemplo do campo nome, ex.: "NovaVida". */
  exemplo: string
  /** Ícone da seção. */
  icon: LucideIcon
  onCreate: (input: ItemCatalogoInput) => Promise<CatalogoActionResult>
  onUpdate: (id: string, input: ItemCatalogoInput) => Promise<CatalogoActionResult>
  onDelete: (id: string) => Promise<CatalogoActionResult>
}

export function CatalogoManager({
  itens,
  contagemLeads,
  config,
}: {
  itens: ItemCatalogo[]
  /** Nº de leads que usam cada valor (por nome), para dar contexto de uso. */
  contagemLeads: Record<string, number>
  config: CatalogoConfig
}) {
  const { singular, plural, titulo, exemplo, icon: Icon, onCreate, onUpdate, onDelete } = config

  const [busca, setBusca] = useState("")
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<ItemCatalogo | null>(null)
  const [excluindo, setExcluindo] = useState<ItemCatalogo | null>(null)
  const [pending, startTransition] = useTransition()

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return itens
    return itens.filter(
      (p) => p.nome.toLowerCase().includes(termo) || (p.descricao ?? "").toLowerCase().includes(termo),
    )
  }, [itens, busca])

  const ativos = itens.filter((p) => p.ativo).length

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(item: ItemCatalogo) {
    setEmEdicao(item)
    setDialogAberto(true)
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await onDelete(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {titulo}
            </CardTitle>
            <CardDescription>
              {itens.length === 0
                ? `Nenhuma ${singular} cadastrada ainda.`
                : `${formatNumber(itens.length)} ${plural} · ${formatNumber(ativos)} ativa(s).`}
            </CardDescription>
          </div>
          <Button onClick={abrirNovo} className="shrink-0">
            <Plus className="size-4" />
            Nova {singular}
          </Button>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {itens.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Cadastre a primeira {singular}</EmptyTitle>
                <EmptyDescription>
                  Os itens criados aqui ficam disponíveis para seleção ao criar ou editar leads.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Nova {singular}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="relative max-w-xs">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={`Buscar ${singular}...`}
                  className="pl-8"
                  aria-label={`Buscar ${singular}`}
                />
              </div>

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{titulo}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="w-24 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtrados.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                          Nenhum resultado encontrado para {'"'}
                          {busca}
                          {'"'}.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtrados.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium">{item.nome}</span>
                              {item.descricao ? (
                                <span className="text-xs text-muted-foreground">{item.descricao}</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            {item.ativo ? (
                              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                                Ativo
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Inativo</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatNumber(contagemLeads[item.nome] ?? 0)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => abrirEdicao(item)}
                                aria-label={`Editar ${item.nome}`}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setExcluindo(item)}
                                aria-label={`Excluir ${item.nome}`}
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CatalogoFormDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        item={emEdicao}
        singular={singular}
        descricaoExemplo={exemplo}
        onCreate={onCreate}
        onUpdate={onUpdate}
      />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {singular}?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${excluindo.nome}" deixará de aparecer como opção. Os leads que já usam este valor não são alterados. Esta ação não pode ser desfeita.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmarExclusao} disabled={pending}>
              {pending ? <Spinner /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
