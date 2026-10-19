"use client"

import { useEffect, useState, useTransition } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { salvarEtapasFunilAction } from "@/app/actions/funis"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  FUNIL_COR_ESTILOS,
  FUNIL_CORES,
  FUNIL_ETAPAS_MAX,
  FUNIL_ETAPAS_MIN,
  FUNIL_ETAPA_NOME_MAX,
  FUNIL_TIPO_ROTULO,
  FUNIL_ETAPA_TIPOS,
  type FunilBoardData,
  type FunilCor,
  type FunilEtapaTipo,
} from "@/lib/funis"
import { cn } from "@/lib/utils"

type Linha = { chave: string; id: string | null; nome: string; cor: FunilCor; tipo: FunilEtapaTipo }

let contador = 0
const novaChave = () => `nova-${++contador}`

export function FunilEtapasDialog({
  open,
  onOpenChange,
  board,
  aoSalvar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  board: FunilBoardData
  aoSalvar: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [destinoId, setDestinoId] = useState("")

  useEffect(() => {
    if (!open) return
    setLinhas(board.funil.etapas.map((e) => ({ chave: e.id, id: e.id, nome: e.nome, cor: e.cor, tipo: e.tipo })))
    setDestinoId("")
  }, [open, board])

  const mantidos = new Set(linhas.map((l) => l.id).filter((id): id is string => id !== null))
  const removidas = board.funil.etapas.filter((e) => !mantidos.has(e.id))
  const leadsAMover = removidas.reduce((acc, e) => acc + (board.totais[e.id]?.total ?? 0), 0)
  const opcoesDestino = linhas.filter((l) => l.id !== null).map((l) => ({ value: l.id as string, label: l.nome || "Sem nome" }))

  function atualizar(chave: string, patch: Partial<Linha>) {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))
  }

  function mover(indice: number, delta: -1 | 1) {
    setLinhas((atual) => {
      const alvo = indice + delta
      if (alvo < 0 || alvo >= atual.length) return atual
      const copia = [...atual]
      ;[copia[indice], copia[alvo]] = [copia[alvo], copia[indice]]
      return copia
    })
  }

  function salvar() {
    startTransition(async () => {
      const resultado = await salvarEtapasFunilAction(
        board.funil.id,
        linhas.map((l) => ({ id: l.id, nome: l.nome, cor: l.cor, tipo: l.tipo })),
        leadsAMover > 0 ? destinoId || null : null,
      )
      if (!resultado.ok) return void toast.error(resultado.message)
      toast.success(resultado.message)
      onOpenChange(false)
      aoSalvar()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Etapas de {board.funil.nome}</DialogTitle>
          <DialogDescription>
            Defina a ordem do funil, da primeira etapa à última. Etapas “Ganho” e “Perdido” encerram o negócio e entram na taxa de conversão.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2">
          {linhas.map((linha, indice) => (
            <li key={linha.chave} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <span className={cn("size-2.5 shrink-0 rounded-full", FUNIL_COR_ESTILOS[linha.cor].ponto)} aria-hidden />
              <Input
                value={linha.nome}
                onChange={(e) => atualizar(linha.chave, { nome: e.target.value })}
                maxLength={FUNIL_ETAPA_NOME_MAX}
                placeholder="Nome da etapa"
                aria-label={`Nome da etapa ${indice + 1}`}
                className="min-w-0 flex-1 basis-40"
              />
              <SelectField
                value={linha.tipo}
                onValueChange={(valor) => atualizar(linha.chave, { tipo: valor as FunilEtapaTipo })}
                opcoes={FUNIL_ETAPA_TIPOS.map((t) => ({ value: t, label: FUNIL_TIPO_ROTULO[t] }))}
                size="sm"
                className="w-36"
              />
              <SelectField
                value={linha.cor}
                onValueChange={(valor) => atualizar(linha.chave, { cor: valor as FunilCor })}
                opcoes={FUNIL_CORES.map((c) => ({ value: c, label: FUNIL_COR_ESTILOS[c].rotulo }))}
                size="sm"
                className="w-28"
              />
              <div className="ml-auto flex items-center">
                <Button type="button" variant="ghost" size="icon" disabled={indice === 0} onClick={() => mover(indice, -1)} aria-label="Subir etapa">
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={indice === linhas.length - 1}
                  onClick={() => mover(indice, 1)}
                  aria-label="Descer etapa"
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={linhas.length <= FUNIL_ETAPAS_MIN}
                  onClick={() => setLinhas((atual) => atual.filter((l) => l.chave !== linha.chave))}
                  aria-label="Remover etapa"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          disabled={linhas.length >= FUNIL_ETAPAS_MAX}
          onClick={() => setLinhas((atual) => [...atual, { chave: novaChave(), id: null, nome: "", cor: "azul", tipo: "aberta" }])}
          className="self-start"
        >
          <Plus className="size-4" />
          Adicionar etapa
        </Button>

        {leadsAMover > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>
              {leadsAMover} {leadsAMover === 1 ? "lead está" : "leads estão"} em etapas que você removeu. Para onde eles devem ir?
            </p>
            <SelectField value={destinoId} onValueChange={setDestinoId} opcoes={opcoesDestino} placeholder="Escolha a etapa de destino" />
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending || (leadsAMover > 0 && !destinoId)}>
            {pending ? <Spinner /> : null}
            Salvar etapas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
