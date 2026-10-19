"use client"

import { useEffect, useState, useTransition, type KeyboardEvent } from "react"
import { Check, Pencil, Plus, Tag, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import {
  createChatTagAction,
  deleteChatTagAction,
  listChatTagsAction,
  setLeadChatTagAction,
  updateChatTagAction,
} from "@/app/actions/chat"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import {
  CHAT_TAGS_MAX,
  CHAT_TAGS_POR_LEAD_MAX,
  CHAT_TAG_COR_PADRAO,
  CHAT_TAG_CORES,
  CHAT_TAG_ESTILOS,
  CHAT_TAG_NOME_MAX,
  type ChatTag,
  type ChatTagComContagem,
  type ChatTagCor,
} from "@/lib/chat-tags"
import { cn } from "@/lib/utils"

/** Etiqueta colorida (usada na lista, no cabeçalho da conversa e nos filtros). */
export function ChatTagBadge({ tag, className }: { tag: ChatTag; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 max-w-32 items-center rounded-full px-2 text-[11px] font-medium", CHAT_TAG_ESTILOS[tag.cor].badge, className)}
      title={tag.nome}
    >
      <span className="truncate">{tag.nome}</span>
    </span>
  )
}

function SeletorDeCor({ valor, onChange, disabled }: { valor: ChatTagCor; onChange: (cor: ChatTagCor) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cor da etiqueta">
      {CHAT_TAG_CORES.map((cor) => (
        <button
          key={cor}
          type="button"
          role="radio"
          aria-checked={valor === cor}
          aria-label={CHAT_TAG_ESTILOS[cor].rotulo}
          title={CHAT_TAG_ESTILOS[cor].rotulo}
          disabled={disabled}
          onClick={() => onChange(cor)}
          className={cn(
            "size-5 rounded-full ring-offset-2 ring-offset-popover transition disabled:opacity-50",
            CHAT_TAG_ESTILOS[cor].ponto,
            valor === cor ? "ring-2 ring-foreground/70" : "hover:scale-110",
          )}
        />
      ))}
    </div>
  )
}

export interface ResultadoDeEtiqueta {
  /** Todas as etiquetas da instância, já atualizadas. */
  tags: ChatTag[]
  /** Etiquetas da conversa afetada (quando a ação foi numa conversa). */
  tagsDoLead?: ChatTag[]
}

/** Botão do cabeçalho da conversa: aplicar/remover etiquetas e criar uma nova na hora. */
export function ChatTagsPopover({
  leadId,
  tags,
  aplicadas,
  onResultado,
  onGerenciar,
}: {
  leadId: string
  tags: ChatTag[]
  aplicadas: ChatTag[]
  onResultado: (resultado: ResultadoDeEtiqueta) => void
  /** Abre a tela de gerenciamento (renomear/excluir). */
  onGerenciar?: () => void
}) {
  const [nome, setNome] = useState("")
  const [cor, setCor] = useState<ChatTagCor>(CHAT_TAG_COR_PADRAO)
  const [pendente, iniciar] = useTransition()
  const idsAplicados = new Set(aplicadas.map((tag) => tag.id))

  function alternar(tag: ChatTag) {
    const aplicar = !idsAplicados.has(tag.id)
    iniciar(async () => {
      const resultado = await setLeadChatTagAction(leadId, tag.id, aplicar)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      onResultado({ tags: resultado.tags, tagsDoLead: resultado.tagsDoLead })
    })
  }

  function criar() {
    if (!nome.trim() || pendente) return
    iniciar(async () => {
      const resultado = await createChatTagAction(nome, cor, leadId)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      onResultado({ tags: resultado.tags, tagsDoLead: resultado.tagsDoLead })
      setNome("")
    })
  }

  function aoDigitar(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      criar()
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant={aplicadas.length > 0 ? "secondary" : "ghost"} size="sm" className="rounded-full" title="Etiquetas desta conversa">
            <Tag className="size-4" />
            <span className="hidden sm:inline">Etiquetas</span>
            {aplicadas.length > 0 ? <span className="tabular-nums">{aplicadas.length}</span> : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Etiquetas da conversa</PopoverTitle>
        </PopoverHeader>

        {tags.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
            Nenhuma etiqueta ainda. Crie a primeira abaixo.
          </p>
        ) : (
          <ul className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
            {tags.map((tag) => {
              const ativa = idsAplicados.has(tag.id)
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={ativa}
                    disabled={pendente}
                    onClick={() => alternar(tag)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", CHAT_TAG_ESTILOS[tag.cor].ponto)} />
                    <span className="min-w-0 flex-1 truncate">{tag.nome}</span>
                    {ativa ? <Check className="size-4 shrink-0 text-primary" /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {aplicadas.length >= CHAT_TAGS_POR_LEAD_MAX ? (
          <p className="text-xs text-muted-foreground">Limite de {CHAT_TAGS_POR_LEAD_MAX} etiquetas por conversa.</p>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-2.5">
          <p className="text-xs font-medium text-muted-foreground">Nova etiqueta</p>
          <div className="flex gap-1.5">
            <Input
              value={nome}
              maxLength={CHAT_TAG_NOME_MAX}
              onChange={(event) => setNome(event.target.value)}
              onKeyDown={aoDigitar}
              placeholder="Ex.: Quente, Cliente VIP"
              aria-label="Nome da nova etiqueta"
              disabled={pendente}
              className="h-8"
            />
            <Button type="button" size="icon" className="size-8 shrink-0" aria-label="Criar etiqueta" title="Criar e aplicar" disabled={pendente || !nome.trim()} onClick={criar}>
              <Plus className="size-4" />
            </Button>
          </div>
          <SeletorDeCor valor={cor} onChange={setCor} disabled={pendente} />
        </div>

        {onGerenciar ? (
          <Button type="button" variant="ghost" size="sm" className="w-full justify-center" onClick={onGerenciar}>
            Gerenciar etiquetas
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** Gerenciar as etiquetas da instância: criar, renomear, trocar a cor e excluir (editar/excluir só para admin). */
export function ChatTagsDialog({
  open,
  onOpenChange,
  podeGerenciar,
  onTagsChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Renomear, mudar a cor e excluir. Quem não pode vê a lista e só cria. */
  podeGerenciar: boolean
  onTagsChange: (tags: ChatTag[]) => void
}) {
  const [itens, setItens] = useState<ChatTagComContagem[]>([])
  const [carregando, setCarregando] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [nome, setNome] = useState("")
  const [cor, setCor] = useState<ChatTagCor>(CHAT_TAG_COR_PADRAO)
  const [pendente, iniciar] = useTransition()

  // Traz a contagem de conversas por etiqueta sempre que a tela abre.
  useEffect(() => {
    if (!open) return
    let ativo = true
    setCarregando(true)
    listChatTagsAction()
      .then((lista) => ativo && setItens(lista))
      .catch(() => ativo && toast.error("Não foi possível carregar as etiquetas."))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [open])

  function limpar() {
    setEditandoId(null)
    setConfirmandoId(null)
    setNome("")
    setCor(CHAT_TAG_COR_PADRAO)
  }

  function fechar(proximo: boolean) {
    if (pendente) return
    onOpenChange(proximo)
    if (!proximo) limpar()
  }

  function aplicarTags(tags: ChatTag[]) {
    setItens((atuais) => tags.map((tag) => ({ ...tag, total: atuais.find((item) => item.id === tag.id)?.total ?? 0 })))
    onTagsChange(tags)
  }

  function editar(tag: ChatTag) {
    setConfirmandoId(null)
    setEditandoId(tag.id)
    setNome(tag.nome)
    setCor(tag.cor)
  }

  function salvar() {
    iniciar(async () => {
      const resultado = editandoId ? await updateChatTagAction(editandoId, nome, cor) : await createChatTagAction(nome, cor)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      aplicarTags(resultado.tags)
      limpar()
    })
  }

  function excluir(tag: ChatTag) {
    iniciar(async () => {
      const resultado = await deleteChatTagAction(tag.id)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      aplicarTags(resultado.tags)
      limpar()
    })
  }

  const limiteAtingido = itens.length >= CHAT_TAGS_MAX && !editandoId

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Etiquetas do chat</DialogTitle>
          <DialogDescription>
            As etiquetas valem para toda a equipe: você aplica nas conversas e também filtra a lista por elas.
            {podeGerenciar ? "" : " Renomear e excluir é com os administradores."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">Etiquetas</span>
            <span className="tabular-nums">{itens.length}/{CHAT_TAGS_MAX}</span>
          </div>
          {carregando && itens.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : itens.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma etiqueta ainda. Crie a primeira abaixo.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {itens.map((tag) => (
                <li key={tag.id} className="flex items-center gap-2 rounded-md border px-3 py-2 data-[editando=true]:border-primary" data-editando={editandoId === tag.id}>
                  <ChatTagBadge tag={tag} className="max-w-48" />
                  <span className="flex-1 text-xs text-muted-foreground tabular-nums">
                    {tag.total} {tag.total === 1 ? "conversa" : "conversas"}
                  </span>
                  {podeGerenciar ? (
                    confirmandoId === tag.id ? (
                      <>
                        <Button type="button" variant="destructive" size="sm" disabled={pendente} onClick={() => excluir(tag)}>
                          Excluir
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Cancelar exclusão" disabled={pendente} onClick={() => setConfirmandoId(null)}>
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Editar ${tag.nome}`} title="Editar" disabled={pendente} onClick={() => editar(tag)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Excluir ${tag.nome}`} title="Excluir" disabled={pendente} onClick={() => { setEditandoId(null); setConfirmandoId(tag.id) }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {confirmandoId ? (
            <p className="text-xs text-muted-foreground">A etiqueta sai de todas as conversas em que está. Isso não pode ser desfeito.</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm font-medium">{editandoId ? "Editar etiqueta" : "Nova etiqueta"}</p>
          {limiteAtingido ? (
            <p className="text-sm text-muted-foreground">Limite de {CHAT_TAGS_MAX} etiquetas atingido. Exclua uma para criar outra.</p>
          ) : (
            <>
              <Input
                value={nome}
                maxLength={CHAT_TAG_NOME_MAX}
                onChange={(event) => setNome(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && nome.trim() && !pendente) {
                    event.preventDefault()
                    salvar()
                  }
                }}
                placeholder="Ex.: Quente, Cliente VIP, Pós-venda"
                aria-label="Nome da etiqueta"
                disabled={pendente}
              />
              <SeletorDeCor valor={cor} onChange={setCor} disabled={pendente} />
              <div className="flex items-center justify-end gap-2">
                {editandoId ? (
                  <Button type="button" variant="ghost" onClick={limpar} disabled={pendente}>
                    Cancelar edição
                  </Button>
                ) : null}
                <Button type="button" onClick={salvar} disabled={pendente || !nome.trim()}>
                  {editandoId ? null : <Plus className="size-4" />}
                  {pendente ? "Salvando…" : editandoId ? "Salvar alterações" : "Criar etiqueta"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
