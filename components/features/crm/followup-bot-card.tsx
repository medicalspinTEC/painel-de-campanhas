"use client"

import { useEffect, useState, useTransition } from "react"
import { MessageSquareReply, Pencil, Plus, Power, PowerOff, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  createFollowUpBotAction,
  deleteFollowUpBotAction,
  deleteFollowUpTemplateAction,
  saveFollowUpBotAction,
  saveFollowUpTemplateAction,
  setFollowUpBotAtivoAction,
} from "@/app/actions/crm"
import { SelectField } from "@/components/shared/select-field"
import { separarTempo, textoTempo } from "@/lib/followup-regras"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { FollowUpBotItem, FollowUpTemplateItem } from "@/services/followup"

const UNIDADES = [
  { value: "1", label: "minutos" },
  { value: "60", label: "horas" },
  { value: "1440", label: "dias" },
]

const OPCOES_MODO = [
  { value: "aleatorio", label: "Aleatório (sorteia entre os templates ativos)" },
  { value: "especifico", label: "Template específico" },
]

/**
 * Bot especialista em follow-up de um departamento: tempo sem resposta, quantos follow-ups seguidos,
 * como escolher o template e a lista de templates.
 */
export function FollowUpBotCard({ departamentoId, bot }: { departamentoId: string; bot: FollowUpBotItem | null }) {
  const [pending, startTransition] = useTransition()
  const [configAberta, setConfigAberta] = useState(false)
  const [templateAberto, setTemplateAberto] = useState(false)
  const [templateEmEdicao, setTemplateEmEdicao] = useState<FollowUpTemplateItem | null>(null)
  const [excluindoBot, setExcluindoBot] = useState(false)
  const [excluindoTemplate, setExcluindoTemplate] = useState<FollowUpTemplateItem | null>(null)

  function criar() {
    startTransition(async () => {
      const resultado = await createFollowUpBotAction(departamentoId)
      if (resultado.ok) {
        toast.success(resultado.message)
        setConfigAberta(true)
      } else toast.error(resultado.message)
    })
  }

  function alternar() {
    if (!bot) return
    startTransition(async () => {
      const resultado = await setFollowUpBotAtivoAction(bot.id, !bot.ativo)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  function confirmarExclusaoBot() {
    if (!bot) return
    const id = bot.id
    startTransition(async () => {
      const resultado = await deleteFollowUpBotAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindoBot(false)
    })
  }

  function confirmarExclusaoTemplate() {
    if (!excluindoTemplate) return
    const id = excluindoTemplate.id
    startTransition(async () => {
      const resultado = await deleteFollowUpTemplateAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindoTemplate(null)
    })
  }

  function abrirTemplate(template: FollowUpTemplateItem | null) {
    setTemplateEmEdicao(template)
    setTemplateAberto(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageSquareReply className="size-3.5" aria-hidden="true" />
        Bot de follow-up
      </p>

      {!bot ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Envia uma mensagem sozinho quando o lead fica um tempo sem responder à equipe, usando os templates que você
            cadastrar.
          </p>
          <div>
            <Button variant="outline" size="sm" disabled={pending} onClick={criar}>
              {pending ? <Spinner /> : <Plus className="size-3.5" />}
              Criar bot de follow-up
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{bot.nome}</span>
                <Badge variant={bot.ativo ? "default" : "secondary"}>{bot.ativo ? "Ligado" : "Desligado"}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                Envia após {textoTempo(bot.minutosSemResposta)} sem resposta · até {bot.maxFollowUps}{" "}
                {bot.maxFollowUps === 1 ? "follow-up" : "follow-ups"} seguidos ·{" "}
                {bot.modoTemplate === "especifico"
                  ? `template “${bot.templates.find((t) => t.id === bot.templateFixoId)?.nome ?? "—"}”`
                  : "template aleatório"}
                {bot.janelaAtiva ? ` · das ${bot.janelaInicio}h às ${bot.janelaFim}h` : ""}
              </span>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfigAberta(true)}>
                <Settings2 className="size-3.5" />
                Configurar
              </Button>
              <Button variant="outline" size="sm" disabled={pending} onClick={alternar}>
                {bot.ativo ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                {bot.ativo ? "Desligar" : "Ligar"}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Excluir ${bot.nome}`}
                title="Excluir bot de follow-up"
                onClick={() => setExcluindoBot(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Templates ({bot.templates.length})
              </span>
              <Button variant="outline" size="sm" onClick={() => abrirTemplate(null)}>
                <Plus className="size-3.5" />
                Novo template
              </Button>
            </div>
            {bot.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum template. Cadastre ao menos um para poder ligar o bot.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {bot.templates.map((template) => (
                  <li key={template.id} className="flex items-start justify-between gap-2 rounded-md border bg-background p-2.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{template.nome}</span>
                        {!template.ativo ? <Badge variant="outline">Desativado</Badge> : null}
                        {bot.modoTemplate === "especifico" && bot.templateFixoId === template.id ? (
                          <Badge variant="secondary">Em uso</Badge>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">{template.texto}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${template.nome}`} title="Editar" onClick={() => abrirTemplate(template)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${template.nome}`} title="Excluir" onClick={() => setExcluindoTemplate(template)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {bot ? <ConfigDialog open={configAberta} onOpenChange={setConfigAberta} bot={bot} /> : null}
      {bot ? (
        <TemplateDialog open={templateAberto} onOpenChange={setTemplateAberto} botId={bot.id} template={templateEmEdicao} />
      ) : null}

      <AlertDialog open={excluindoBot} onOpenChange={setExcluindoBot}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir bot de follow-up?</AlertDialogTitle>
            <AlertDialogDescription>
              O bot e todos os templates dele serão removidos. As mensagens já enviadas continuam no chat. Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmarExclusaoBot} disabled={pending}>
              {pending ? <Spinner /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(excluindoTemplate)} onOpenChange={(aberto) => !aberto && setExcluindoTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindoTemplate ? `“${excluindoTemplate.nome}” será removido. Chats que o tinham escolhido voltam à regra do bot.` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmarExclusaoTemplate} disabled={pending}>
              {pending ? <Spinner /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ConfigDialog({
  open,
  onOpenChange,
  bot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: FollowUpBotItem
}) {
  const [pending, startTransition] = useTransition()
  const [nome, setNome] = useState(bot.nome)
  const [valor, setValor] = useState("60")
  const [unidade, setUnidade] = useState("1")
  const [maxFollowUps, setMaxFollowUps] = useState("1")
  const [modo, setModo] = useState<string>("aleatorio")
  const [templateFixoId, setTemplateFixoId] = useState("")
  const [janelaAtiva, setJanelaAtiva] = useState(false)
  const [janelaInicio, setJanelaInicio] = useState("8")
  const [janelaFim, setJanelaFim] = useState("20")

  // Recarrega os campos a cada abertura (o diálogo é reaproveitado depois de salvar).
  useEffect(() => {
    if (!open) return
    const tempo = separarTempo(bot.minutosSemResposta)
    setNome(bot.nome)
    setValor(String(tempo.valor))
    setUnidade(tempo.unidade)
    setMaxFollowUps(String(bot.maxFollowUps))
    setModo(bot.modoTemplate)
    setTemplateFixoId(bot.templateFixoId ?? "")
    setJanelaAtiva(bot.janelaAtiva)
    setJanelaInicio(String(bot.janelaInicio))
    setJanelaFim(String(bot.janelaFim))
  }, [open, bot])

  const ativos = bot.templates.filter((t) => t.ativo)

  function salvar() {
    const minutos = Math.round(Number(valor.replace(",", ".")) * Number(unidade))
    startTransition(async () => {
      const resultado = await saveFollowUpBotAction(bot.id, {
        nome,
        minutosSemResposta: minutos,
        maxFollowUps: Number(maxFollowUps),
        modoTemplate: modo === "especifico" ? "especifico" : "aleatorio",
        templateFixoId: modo === "especifico" ? templateFixoId || null : null,
        janelaAtiva,
        janelaInicio: Number(janelaInicio),
        janelaFim: Number(janelaFim),
      })
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else toast.error(resultado.message)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar bot de follow-up</DialogTitle>
          <DialogDescription>
            Vale para as conversas deste departamento que não estão em campanha. Quando o lead responde, a contagem recomeça.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="fu-nome">Nome do bot</FieldLabel>
            <Input id="fu-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
          </Field>

          <Field>
            <FieldLabel htmlFor="fu-tempo">Tempo sem resposta do lead</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="fu-tempo"
                type="number"
                inputMode="numeric"
                min={1}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="w-28"
              />
              <SelectField value={unidade} onValueChange={setUnidade} opcoes={UNIDADES} className="w-32" />
            </div>
            <FieldDescription>
              Conta a partir da última mensagem da equipe (de um atendente, de outro bot ou do próprio follow-up).
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="fu-max">Follow-ups seguidos sem resposta</FieldLabel>
            <Input
              id="fu-max"
              type="number"
              inputMode="numeric"
              min={1}
              max={5}
              value={maxFollowUps}
              onChange={(e) => setMaxFollowUps(e.target.value)}
              className="w-28"
            />
            <FieldDescription>
              Com mais de 1, cada novo follow-up espera o mesmo tempo depois do anterior. Máximo de 5.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Como escolher o template</FieldLabel>
            <SelectField value={modo} onValueChange={setModo} opcoes={OPCOES_MODO} />
            {modo === "especifico" ? (
              <SelectField
                value={templateFixoId}
                onValueChange={setTemplateFixoId}
                placeholder={ativos.length ? "Escolha o template" : "Cadastre um template primeiro"}
                opcoes={ativos.map((t) => ({ value: t.id, label: t.nome }))}
              />
            ) : null}
            <FieldDescription>
              Em cada chat também dá para escolher outro template manualmente, que vale no lugar desta regra.
            </FieldDescription>
          </Field>

          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label htmlFor="fu-janela" className="text-sm font-medium">
                  Enviar só em um horário
                </label>
                <FieldDescription>Fora dele o follow-up espera abrir, em vez de sair de madrugada.</FieldDescription>
              </div>
              <Switch id="fu-janela" checked={janelaAtiva} onCheckedChange={setJanelaAtiva} />
            </div>
            {janelaAtiva ? (
              <div className="flex items-center gap-2 text-sm">
                das
                <Input type="number" inputMode="numeric" min={0} max={23} value={janelaInicio} onChange={(e) => setJanelaInicio(e.target.value)} className="w-20" aria-label="Hora inicial" />
                h às
                <Input type="number" inputMode="numeric" min={1} max={24} value={janelaFim} onChange={(e) => setJanelaFim(e.target.value)} className="w-20" aria-label="Hora final" />h
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TemplateDialog({
  open,
  onOpenChange,
  botId,
  template,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  botId: string
  template: FollowUpTemplateItem | null
}) {
  const [pending, startTransition] = useTransition()
  const [nome, setNome] = useState("")
  const [texto, setTexto] = useState("")
  const [ativo, setAtivo] = useState(true)

  useEffect(() => {
    if (!open) return
    setNome(template?.nome ?? "")
    setTexto(template?.texto ?? "")
    setAtivo(template?.ativo ?? true)
  }, [open, template])

  function salvar() {
    startTransition(async () => {
      const resultado = await saveFollowUpTemplateAction(botId, { id: template?.id ?? null, nome, texto, ativo })
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else toast.error(resultado.message)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Editar template" : "Novo template"}</DialogTitle>
          <DialogDescription>
            Use {"{{primeiro_nome}}"} ou {"{{nome}}"} para personalizar a mensagem com o nome do lead.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="fut-nome">Nome do template</FieldLabel>
            <Input id="fut-nome" value={nome} maxLength={60} placeholder="Lembrete amigável" onChange={(e) => setNome(e.target.value)} />
            <FieldDescription>Só para você identificar; o lead não vê.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="fut-texto">Mensagem</FieldLabel>
            <Textarea
              id="fut-texto"
              value={texto}
              rows={6}
              maxLength={4000}
              placeholder={"Oi, {{primeiro_nome}}! Conseguiu ver o que te enviei? Posso ajudar em algo?"}
              onChange={(e) => setTexto(e.target.value)}
            />
            <FieldDescription>{texto.length}/4000</FieldDescription>
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="fut-ativo" className="text-sm font-medium">
                Template ativo
              </label>
              <FieldDescription>Desativado, o bot não o usa (nem no sorteio).</FieldDescription>
            </div>
            <Switch id="fut-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending || !nome.trim() || !texto.trim()}>
            {pending ? <Spinner /> : null}
            {template ? "Salvar" : "Criar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
