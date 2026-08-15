"use client"

import { useMemo, useState, useTransition } from "react"
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteProdutoAction } from "@/app/actions/produtos"
import { ProdutoFormDialog } from "@/components/features/segmentacao/produto-form-dialog"
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
import type { Produto } from "@/services/produtos"

export function ProdutosManager({
  produtos,
  contagemLeads,
}: {
  produtos: Produto[]
  /** Nº de leads que usam cada produto (por nome), para dar contexto de uso. */
  contagemLeads: Record<string, number>
}) {
  const [busca, setBusca] = useState("")
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Produto | null>(null)
  const [excluindo, setExcluindo] = useState<Produto | null>(null)
  const [pending, startTransition] = useTransition()

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return produtos
    return produtos.filter(
      (p) => p.nome.toLowerCase().includes(termo) || (p.descricao ?? "").toLowerCase().includes(termo),
    )
  }, [produtos, busca])

  const ativos = produtos.filter((p) => p.ativo).length

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(produto: Produto) {
    setEmEdicao(produto)
    setDialogAberto(true)
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await deleteProdutoAction(id)
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
              <Package className="size-4 text-muted-foreground" aria-hidden="true" />
              Produtos
            </CardTitle>
            <CardDescription>
              {produtos.length === 0
                ? "Nenhum produto cadastrado ainda."
                : `${formatNumber(produtos.length)} produto(s) · ${formatNumber(ativos)} ativo(s).`}
            </CardDescription>
          </div>
          <Button onClick={abrirNovo} className="shrink-0">
            <Plus className="size-4" />
            Novo produto
          </Button>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {produtos.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Package className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Cadastre seu primeiro produto</EmptyTitle>
                <EmptyDescription>
                  Os produtos criados aqui ficam disponíveis para seleção ao criar ou editar leads.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Novo produto
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
                  placeholder="Buscar produto..."
                  className="pl-8"
                  aria-label="Buscar produto"
                />
              </div>

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="w-24 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtrados.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                          Nenhum produto encontrado para {'"'}
                          {busca}
                          {'"'}.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtrados.map((produto) => (
                        <TableRow key={produto.id}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium">{produto.nome}</span>
                              {produto.descricao ? (
                                <span className="text-xs text-muted-foreground">{produto.descricao}</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            {produto.ativo ? (
                              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                                Ativo
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Inativo</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatNumber(contagemLeads[produto.nome] ?? 0)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => abrirEdicao(produto)}
                                aria-label={`Editar ${produto.nome}`}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setExcluindo(produto)}
                                aria-label={`Excluir ${produto.nome}`}
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

      <ProdutoFormDialog open={dialogAberto} onOpenChange={setDialogAberto} produto={emEdicao} />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${excluindo.nome}" deixará de aparecer como opção. Os leads que já usam este produto não são alterados. Esta ação não pode ser desfeita.`
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
