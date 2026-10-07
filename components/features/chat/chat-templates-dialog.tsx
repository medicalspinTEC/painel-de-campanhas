"use client"

import { useState, useTransition } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  createChatTemplateAction,
  deleteChatTemplateAction,
  updateChatTemplateAction,
} from "@/app/actions/chat"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  CHAT_TEMPLATES_MAX,
  CHAT_TEMPLATE_NOME_MAX,
  CHAT_TEMPLATE_TEXTO_MAX,
  normalizarNomeTemplate,
  type ChatTemplate,
} from "@/lib/chat-templates"

/** Criar, editar e excluir os templates de mensagem do usuário (até 10). */
export function ChatTemplatesDialog({
  open,
  onOpenChange,
  templates,
  onTemplatesChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: ChatTemplate[]
  onTemplatesChange: (templates: ChatTemplate[]) => void
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nome, setNome] = useState("")
  const [texto, setTexto] = useState("")
  const [pendente, iniciar] = useTransition()

  const limiteAtingido = templates.length >= CHAT_TEMPLATES_MAX && !editandoId
  const nomeFinal = normalizarNomeTemplate(nome)

  function limpar() {
    setEditandoId(null)
    setNome("")
    setTexto("")
  }

  function fechar(proximo: boolean) {
    if (pendente) return
    onOpenChange(proximo)
    if (!proximo) limpar()
  }

  function editar(template: ChatTemplate) {
    setEditandoId(template.id)
    setNome(template.nome)
    setTexto(template.texto)
  }

  function salvar() {
    iniciar(async () => {
      const resultado = editandoId
        ? await updateChatTemplateAction(editandoId, nome, texto)
        : await createChatTemplateAction(nome, texto)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      onTemplatesChange(resultado.templates)
      limpar()
    })
  }

  function excluir(template: ChatTemplate) {
    iniciar(async () => {
      const resultado = await deleteChatTemplateAction(template.id)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      onTemplatesChange(resultado.templates)
      if (editandoId === template.id) limpar()
    })
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Templates de mensagem</DialogTitle>
          <DialogDescription>
            No chat, digite <span className="font-mono">/nome</span> para inserir o texto do template. Aceita{" "}
            {"{{primeiro_nome}}"} para personalizar. Você pode ter até {CHAT_TEMPLATES_MAX} templates; eles são só seus.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">Seus templates</span>
            <span className="tabular-nums">{templates.length}/{CHAT_TEMPLATES_MAX}</span>
          </div>
          {templates.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nenhum template ainda. Crie o primeiro abaixo.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {templates.map((template) => (
                <li
                  key={template.id}
                  className="flex items-start gap-2 rounded-md border px-3 py-2 data-[editando=true]:border-primary"
                  data-editando={editandoId === template.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium">/{template.nome}</p>
                    <p className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">{template.texto}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Editar /${template.nome}`} title="Editar" disabled={pendente} onClick={() => editar(template)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Excluir /${template.nome}`} title="Excluir" disabled={pendente} onClick={() => excluir(template)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm font-medium">{editandoId ? "Editar template" : "Novo template"}</p>
          {limiteAtingido ? (
            <p className="text-sm text-muted-foreground">
              Você chegou ao limite de {CHAT_TEMPLATES_MAX} templates. Exclua um para criar outro.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-muted-foreground">/</span>
                  <Input
                    value={nome}
                    maxLength={CHAT_TEMPLATE_NOME_MAX + 1}
                    onChange={(event) => setNome(event.target.value)}
                    placeholder="boas-vindas"
                    aria-label="Nome do template"
                    disabled={pendente}
                  />
                </div>
                {nome.trim() && nomeFinal !== nome.trim().replace(/^\/+/, "") ? (
                  <span className="pl-4 text-xs text-muted-foreground">
                    Será salvo como <span className="font-mono">/{nomeFinal || "…"}</span> (minúsculo, sem espaços ou acentos).
                  </span>
                ) : null}
              </div>
              <Textarea
                value={texto}
                maxLength={CHAT_TEMPLATE_TEXTO_MAX}
                onChange={(event) => setTexto(event.target.value)}
                placeholder="Olá {{primeiro_nome}}, tudo bem? Como posso ajudar?"
                className="min-h-28 resize-y"
                aria-label="Texto do template"
                disabled={pendente}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">{texto.length}/{CHAT_TEMPLATE_TEXTO_MAX}</span>
                <div className="flex gap-2">
                  {editandoId ? (
                    <Button type="button" variant="ghost" onClick={limpar} disabled={pendente}>Cancelar edição</Button>
                  ) : null}
                  <Button type="button" onClick={salvar} disabled={pendente || !nomeFinal || !texto.trim()}>
                    {editandoId ? null : <Plus className="size-4" />}
                    {pendente ? "Salvando…" : editandoId ? "Salvar alterações" : "Criar template"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
