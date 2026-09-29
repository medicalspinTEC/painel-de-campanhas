"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { Bell, Check, CheckCheck, Filter, MessageCircle, MoreHorizontal, Paperclip, Search, Send, Smile, UserRound } from "lucide-react"

import { refreshChatInboxAction } from "@/app/actions/chat"
import { sendLeadMessageAction } from "@/app/actions/leads"
import { LinkButton } from "@/components/shared/link-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectField } from "@/components/shared/select-field"
import { Textarea } from "@/components/ui/textarea"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { InstanceOption } from "@/services/evolution"
import type { ChatInboxSnapshot, ChatMessage } from "@/services/chat"

const INSTANCIA_PADRAO = "__padrao__"
const INTERVALO_ATUALIZACAO = 8000
const LIMITE_MENSAGEM = 4096

function iniciais(nome: string) {
  return nome.trim().split(/\s+/).slice(0, 2).map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "L"
}

function horario(data: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data))
}

function preview(mensagem: ChatMessage | null) {
  if (!mensagem) return "Inicie uma conversa com este lead"
  return `${mensagem.lado === "lead" ? "Lead: " : "Você: "}${mensagem.texto}`
}

export function ChatInbox({ inicial, instancias }: { inicial: ChatInboxSnapshot; instancias: InstanceOption[] }) {
  const [conversas, setConversas] = useState(inicial.conversas)
  const [conversaSelecionadaId, setConversaSelecionadaId] = useState(inicial.conversaSelecionadaId)
  const [mensagens, setMensagens] = useState(inicial.mensagens)
  const [busca, setBusca] = useState("")
  const [somenteRespostas, setSomenteRespostas] = useState(false)
  const [texto, setTexto] = useState("")
  const [instancia, setInstancia] = useState(INSTANCIA_PADRAO)
  const [enviando, setEnviando] = useState(false)
  const conversaAtiva = conversas.find((conversa) => conversa.id === conversaSelecionadaId) ?? null
  const fimDaConversa = useRef<HTMLDivElement>(null)
  const idSelecionadoRef = useRef(conversaSelecionadaId)

  const conversasVisiveis = conversas.filter((conversa) => {
    const correspondeBusca = `${conversa.nome} ${conversa.telefone} ${conversa.produto}`.toLowerCase().includes(busca.toLowerCase())
    return correspondeBusca && (!somenteRespostas || conversa.ultimaMensagem?.lado === "lead")
  })
  const totalComResposta = conversas.filter((conversa) => conversa.ultimaMensagem?.lado === "lead").length
  const opcoesInstancia = [
    { value: INSTANCIA_PADRAO, label: "Instância padrão" },
    ...instancias.map((item) => ({ value: item.nome, label: `${item.nome} · ${item.estado}` })),
  ]

  useEffect(() => {
    idSelecionadoRef.current = conversaSelecionadaId
  }, [conversaSelecionadaId])

  useEffect(() => {
    let ativo = true
    let timer: ReturnType<typeof setTimeout>

    async function atualizar() {
      try {
        const snapshot = await refreshChatInboxAction(conversaSelecionadaId)
        if (ativo && idSelecionadoRef.current === conversaSelecionadaId) {
          setConversas(snapshot.conversas)
          setMensagens(snapshot.mensagens)
          if (!conversaSelecionadaId && snapshot.conversaSelecionadaId) {
            setConversaSelecionadaId(snapshot.conversaSelecionadaId)
          }
        }
      } catch {
        // A próxima atualização tenta novamente sem interromper a conversa aberta.
      } finally {
        if (ativo) timer = setTimeout(atualizar, INTERVALO_ATUALIZACAO)
      }
    }

    timer = setTimeout(atualizar, INTERVALO_ATUALIZACAO)
    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [conversaSelecionadaId])

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [mensagens])

  async function selecionarConversa(id: string) {
    idSelecionadoRef.current = id
    setConversaSelecionadaId(id)
    setMensagens([])
    try {
      const snapshot = await refreshChatInboxAction(id)
      if (idSelecionadoRef.current === id) {
        setConversas(snapshot.conversas)
        setMensagens(snapshot.mensagens)
      }
    } catch {
      toast.error("Não foi possível carregar o histórico desta conversa.")
    }
  }

  async function enviarMensagem() {
    const leadId = conversaAtiva?.id
    const mensagem = texto.trim()
    if (!leadId || !mensagem || enviando) return

    setEnviando(true)
    const resultado = await sendLeadMessageAction(
      leadId,
      mensagem,
      instancia === INSTANCIA_PADRAO ? null : instancia,
    )
    setEnviando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    setTexto("")
    toast.success(resultado.message)
    try {
      const snapshot = await refreshChatInboxAction(leadId)
      setConversas(snapshot.conversas)
      setMensagens(snapshot.mensagens)
    } catch {
      toast.message("Mensagem enviada. O histórico será atualizado em instantes.")
    }
  }

  function tratarTecla(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void enviarMensagem()
    }
  }

  return (
    <div className="flex min-h-[calc(100svh-8rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance md:text-2xl">Chat</h1>
          <p className="text-sm text-muted-foreground">Conversas com leads em um só lugar.</p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5 border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-600" /> Atualização automática
        </Badge>
      </div>

      <div className="grid min-h-155 flex-1 grid-cols-1 overflow-hidden rounded-lg border bg-card lg:grid-cols-[minmax(260px,310px)_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_250px]">
        <aside className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
            <div>
              <h2 className="text-sm font-semibold">Leads e conversas</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{conversas.length} leads cadastrados</p>
            </div>
            <Button
              variant={somenteRespostas ? "secondary" : "ghost"}
              size="icon"
              aria-label="Alternar filtro de respostas"
              aria-pressed={somenteRespostas}
              title="Alternar filtro de respostas"
              onClick={() => setSomenteRespostas((atual) => !atual)}
            >
              <Filter className="size-4" />
            </Button>
          </div>
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar lead..." className="pl-8" aria-label="Buscar leads" />
            </div>
          </div>
          <div className="flex gap-1 px-3 pb-2">
            <Button variant={!somenteRespostas ? "secondary" : "ghost"} size="sm" onClick={() => setSomenteRespostas(false)}>Todos</Button>
            <Button variant={somenteRespostas ? "secondary" : "ghost"} size="sm" onClick={() => setSomenteRespostas(true)}>
              Com resposta <span className="ml-1 tabular-nums">{totalComResposta}</span>
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversasVisiveis.length ? conversasVisiveis.map((conversa) => (
              <button
                key={conversa.id}
                type="button"
                onClick={() => void selecionarConversa(conversa.id)}
                className={cn("flex w-full items-start gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-muted/60", conversaSelecionadaId === conversa.id && "bg-accent/70")}
              >
                <Avatar className="mt-0.5 size-10 shrink-0">
                  <AvatarFallback className={cn("text-xs font-semibold", conversa.ultimaMensagem?.lado === "lead" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                    {iniciais(conversa.nome)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{conversa.nome}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {conversa.ultimaMensagem ? formatRelative(conversa.ultimaMensagem.data) : "Novo"}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{preview(conversa.ultimaMensagem)}</span>
                </span>
              </button>
            )) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum lead encontrado.</p>
            )}
          </div>
        </aside>

        <section className="flex min-h-140 min-w-0 flex-col">
          {conversaAtiva ? (
            <>
              <header className="flex min-h-16 items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-9 shrink-0"><AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{iniciais(conversaAtiva.nome)}</AvatarFallback></Avatar>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{conversaAtiva.nome}</h2>
                    <p className="truncate text-xs text-muted-foreground">{conversaAtiva.telefone}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" disabled aria-label="Notificações" title="Notificações em breve"><Bell className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled aria-label="Mais opções" title="Opções em breve"><MoreHorizontal className="size-4" /></Button>
                </div>
              </header>

              <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-[linear-gradient(135deg,oklch(0.97_0.018_160)_0%,var(--background)_45%,oklch(0.97_0.012_75)_100%)] px-4 py-5 dark:bg-[linear-gradient(135deg,oklch(0.2_0.02_160)_0%,var(--background)_55%,oklch(0.21_0.018_75)_100%)] sm:px-6">
                {mensagens.length ? mensagens.map((mensagem) => (
                  <div key={mensagem.id} className={cn("flex max-w-[88%] flex-col gap-1 sm:max-w-[75%]", mensagem.lado === "equipe" ? "self-end" : "self-start")}>
                    <div className={cn("whitespace-pre-wrap wrap-break-word rounded-lg px-3.5 py-2.5 text-sm leading-relaxed shadow-sm", mensagem.lado === "equipe" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card text-card-foreground")}>
                      {mensagem.texto || "(mensagem sem texto)"}
                    </div>
                    <div className={cn("flex items-center gap-1 text-[10px] text-muted-foreground", mensagem.lado === "equipe" && "justify-end")}>
                      {mensagem.campanhaNome ? <span className="mr-1 max-w-40 truncate">{mensagem.campanhaNome} ·</span> : null}
                      <span>{horario(mensagem.data)}</span>
                      {mensagem.lado === "equipe" ? <CheckCheck className="size-3.5" /> : <MessageCircle className="size-3" />}
                    </div>
                  </div>
                )) : (
                  <div className="m-auto flex max-w-sm flex-col items-center gap-2 py-12 text-center">
                    <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircle className="size-5" /></span>
                    <p className="text-sm font-medium">Inicie a conversa com {conversaAtiva.nome}</p>
                    <p className="text-xs text-muted-foreground">As mensagens enviadas e as respostas recebidas aparecerão aqui.</p>
                  </div>
                )}
                <div ref={fimDaConversa} />
              </div>

              <div className="border-t bg-card p-3 sm:p-4">
                <div className="mb-2 flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="icon" disabled aria-label="Anexar arquivo" title="Anexos ainda não disponíveis"><Paperclip className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled aria-label="Inserir emoji" title="Emojis ainda não disponíveis"><Smile className="size-4" /></Button>
                  {instancias.length ? (
                    <SelectField
                      value={instancia}
                      onValueChange={setInstancia}
                      opcoes={opcoesInstancia}
                      size="sm"
                      className="ml-auto w-auto min-w-40 max-w-56"
                      disabled={enviando}
                    />
                  ) : <span className="ml-auto text-[11px] text-muted-foreground">Instância padrão</span>}
                </div>
                <div className="flex items-end gap-2">
                  <Textarea
                    value={texto}
                    onChange={(event) => setTexto(event.target.value)}
                    onKeyDown={tratarTecla}
                    maxLength={LIMITE_MENSAGEM}
                    placeholder={`Escreva uma mensagem para ${conversaAtiva.nome}...`}
                    className="min-h-12 max-h-32 resize-y bg-muted/40"
                    aria-label="Mensagem para o lead"
                    disabled={enviando}
                  />
                  <Button size="icon" onClick={() => void enviarMensagem()} disabled={enviando || !texto.trim()} aria-label="Enviar mensagem" title="Enviar mensagem">
                    <Send className="size-4" />
                  </Button>
                </div>
                <div className="mt-1 flex justify-between px-1 text-[10px] text-muted-foreground">
                  <span>Enter para enviar · Shift+Enter para nova linha</span>
                  <span className="tabular-nums">{texto.length}/{LIMITE_MENSAGEM}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <MessageCircle className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Cadastre um lead para começar uma conversa.</p>
              <LinkButton variant="outline" href="/leads">Ver leads</LinkButton>
            </div>
          )}
        </section>

        <aside className="hidden flex-col border-l 2xl:flex">
          {conversaAtiva ? (
            <>
              <div className="flex flex-col items-center border-b px-4 py-6 text-center">
                <Avatar className="size-16"><AvatarFallback className="bg-primary/15 text-lg font-semibold text-primary">{iniciais(conversaAtiva.nome)}</AvatarFallback></Avatar>
                <h2 className="mt-3 text-sm font-semibold">{conversaAtiva.nome}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{conversaAtiva.telefone}</p>
                <Badge variant="secondary" className="mt-3 gap-1"><UserRound className="size-3" /> Lead cadastrado</Badge>
              </div>
              <div className="flex flex-col gap-4 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><UserRound className="size-3.5" /> Dados do lead</div>
                <dl className="flex flex-col gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Interesse</dt><dd className="mt-0.5 font-medium">{conversaAtiva.produto || "Não informado"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Telefone</dt><dd className="mt-0.5 font-medium">{conversaAtiva.telefone}</dd></div>
                </dl>
                <div className="border-t pt-4">
                  <LinkButton variant="outline" className="w-full" href={`/leads/${conversaAtiva.id}`}>
                    Ver cadastro completo
                  </LinkButton>
                </div>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
