"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { CheckCheck, Filter, Megaphone, MessageCircle, MessagesSquare, MessageSquareReply, MoreHorizontal, Search, Send, Smile, StickyNote, UserRound, X } from "lucide-react"

import { createChatInternalNoteAction, refreshChatInboxAction } from "@/app/actions/chat"
import { sendLeadMessageAction, setLeadStatusAction } from "@/app/actions/leads"
import { LinkButton } from "@/components/shared/link-button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectField } from "@/components/shared/select-field"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { InstanceOption } from "@/services/evolution"
import type { ChatInboxSnapshot, ChatMessage } from "@/services/chat"

const INSTANCIA_PADRAO = "__padrao__"
const INTERVALO_ATUALIZACAO = 8000
const LIMITE_MENSAGEM = 4096
const LIMITE_NOTA_INTERNA = 5000
const EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😉",
  "😊", "😍", "🥰", "😘", "😎", "🤔", "🙌", "🙏",
  "👏", "👍", "👎", "🤝", "💬", "❤️", "💚", "✨",
  "🎉", "🔥", "✅", "📅", "👋", "💪", "🌷", "☀️",
]

function iniciais(nome: string) {
  return nome.trim().split(/\s+/).slice(0, 2).map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "L"
}

function horario(data: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data))
}

function preview(mensagem: ChatMessage | null) {
  if (!mensagem) return "Inicie uma conversa com este lead"
  const autor = mensagem.lado === "lead" ? "Lead" : mensagem.lado === "interno" ? "Nota interna" : "Você"
  return `${autor}: ${mensagem.texto}`
}

export function ChatInbox({ inicial, instancias }: { inicial: ChatInboxSnapshot; instancias: InstanceOption[] }) {
  const [conversas, setConversas] = useState(inicial.conversas)
  const [conversaSelecionadaId, setConversaSelecionadaId] = useState(inicial.conversaSelecionadaId)
  const [conversaFechada, setConversaFechada] = useState(false)
  const [mensagens, setMensagens] = useState(inicial.mensagens)
  const [busca, setBusca] = useState("")
  const [somenteRespostas, setSomenteRespostas] = useState(false)
  const [abaAtiva, setAbaAtiva] = useState<"conversa" | "perfil">("conversa")
  const [modoComposicao, setModoComposicao] = useState<"mensagem" | "nota" | "resposta">("mensagem")
  const [texto, setTexto] = useState("")
  const [seletorEmojiAberto, setSeletorEmojiAberto] = useState(false)
  const [instancia, setInstancia] = useState(INSTANCIA_PADRAO)
  const [enviando, setEnviando] = useState(false)
  const limiteTexto = modoComposicao === "nota" ? LIMITE_NOTA_INTERNA : LIMITE_MENSAGEM
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
          if (!conversaSelecionadaId && snapshot.conversaSelecionadaId && !conversaFechada) {
            setConversaSelecionadaId(snapshot.conversaSelecionadaId)
          }
          if (conversaFechada) setMensagens([])
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
  }, [conversaFechada, conversaSelecionadaId])

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [mensagens])

  async function selecionarConversa(id: string) {
    idSelecionadoRef.current = id
    setConversaFechada(false)
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
    const resultado = modoComposicao === "nota"
      ? await createChatInternalNoteAction(leadId, mensagem)
      : modoComposicao === "resposta"
        ? await setLeadStatusAction(leadId, "respondeu", mensagem)
        : await sendLeadMessageAction(leadId, mensagem, instancia === INSTANCIA_PADRAO ? null : instancia)
    setEnviando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    setTexto("")
    if (modoComposicao === "resposta") setModoComposicao("mensagem")
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

  function inserirEmoji(emoji: string) {
    setTexto((atual) => `${atual}${emoji}`)
    setSeletorEmojiAberto(false)
  }

  function trocarModoComposicao(modo: "mensagem" | "nota" | "resposta") {
    setModoComposicao(modo)
    setTexto("")
  }

  return (
    <div className="flex h-[calc(100svh-8rem)] min-h-160 flex-col gap-4 lg:min-h-128">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance md:text-2xl">Chat</h1>
          <p className="text-sm text-muted-foreground">Conversas com leads em um só lugar.</p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5 border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-600" /> Atualização automática
        </Badge>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,0.4fr)_minmax(0,0.6fr)] grid-cols-1 overflow-hidden rounded-lg border bg-card lg:grid-rows-1 lg:grid-cols-[minmax(260px,310px)_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_250px]">
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

        <section className="flex min-h-0 min-w-0 flex-col">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Sair da conversa"
                    title="Sair da conversa"
                    onClick={() => {
                      idSelecionadoRef.current = null
                      setConversaSelecionadaId(null)
                      setConversaFechada(true)
                      setMensagens([])
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </header>

              {conversaAtiva.campanhasNomes.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-emerald-600/20 bg-emerald-600/10 px-4 py-2.5">
                  <Megaphone className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                  <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Campanha vinculada</span>
                  {conversaAtiva.campanhasNomes.map((nome) => (
                    <Badge key={nome} className="max-w-full border border-emerald-700/20 bg-emerald-700 text-white">
                      <span className="truncate">{nome}</span>
                    </Badge>
                  ))}
                </div>
              ) : null}

              <Tabs
                value={abaAtiva}
                onValueChange={(valor) => setAbaAtiva(String(valor) as "conversa" | "perfil")}
                className="min-h-0 flex-1 gap-0"
              >
                <TabsList className="h-11 w-full justify-start rounded-none border-b bg-transparent px-3">
                  <TabsTrigger value="conversa"><MessagesSquare className="size-4" />Conversa</TabsTrigger>
                  <TabsTrigger value="perfil"><UserRound className="size-4" />Perfil</TabsTrigger>
                </TabsList>
                <TabsContent value="conversa" className="flex min-h-0 flex-1 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-[linear-gradient(135deg,oklch(0.97_0.018_160)_0%,var(--background)_45%,oklch(0.97_0.012_75)_100%)] px-4 py-5 dark:bg-[linear-gradient(135deg,oklch(0.2_0.02_160)_0%,var(--background)_55%,oklch(0.21_0.018_75)_100%)] sm:px-6">
                    {mensagens.length ? mensagens.map((mensagem) => (
                      <div key={mensagem.id} className={cn("flex max-w-[88%] flex-col gap-1 sm:max-w-[75%]", mensagem.lado === "equipe" ? "self-end" : mensagem.lado === "interno" ? "w-full self-center sm:max-w-[85%]" : "self-start")}>
                        <div
                          className={cn(
                            "chat-message-content whitespace-pre-wrap wrap-break-word rounded-lg px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                            mensagem.lado === "equipe"
                              ? "rounded-br-sm bg-primary text-primary-foreground"
                              : mensagem.lado === "interno"
                                ? "border border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                                : "rounded-bl-sm border bg-card text-card-foreground",
                          )}
                          style={{ fontFamily: 'var(--font-sans), "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' }}
                        >
                          {mensagem.lado === "interno" ? <span className="mb-1 block text-xs font-semibold">Nota interna</span> : null}
                          {mensagem.texto || "(mensagem sem texto)"}
                        </div>
                        <div className={cn("flex items-center gap-1 text-[10px] text-muted-foreground", mensagem.lado === "equipe" && "justify-end")}>
                          {mensagem.campanhaNome ? <span className="mr-1 max-w-40 truncate">{mensagem.campanhaNome} ·</span> : null}
                          <span>{horario(mensagem.data)}</span>
                          {mensagem.lado === "equipe" ? <CheckCheck className="size-3.5" /> : mensagem.lado === "interno" ? <StickyNote className="size-3" /> : <MessageCircle className="size-3" />}
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
                      <Popover open={seletorEmojiAberto} onOpenChange={setSeletorEmojiAberto}>
                        <PopoverTrigger
                          render={
                            <Button variant="ghost" size="icon" disabled={enviando} aria-label="Abrir emojis" title="Inserir emoji">
                              <Smile className="size-4" />
                            </Button>
                          }
                        />
                        <PopoverContent align="start" side="top" className="w-72">
                          <PopoverHeader>
                            <PopoverTitle>Escolha um emoji</PopoverTitle>
                          </PopoverHeader>
                          <div className="grid grid-cols-8 gap-1">
                            {EMOJIS.map((emoji) => (
                              <Button
                                key={emoji}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8 text-lg"
                                aria-label={`Inserir emoji ${emoji}`}
                                title={emoji}
                                onClick={() => inserirEmoji(emoji)}
                              >
                                {emoji}
                              </Button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant={modoComposicao === "nota" ? "secondary" : "ghost"}
                        size="icon"
                        aria-label="Nota interna"
                        aria-pressed={modoComposicao === "nota"}
                        title="Nota interna"
                        disabled={enviando}
                        onClick={() => {
                          if (modoComposicao !== "nota") trocarModoComposicao("nota")
                        }}
                      >
                        <StickyNote className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant={modoComposicao === "resposta" ? "secondary" : "ghost"}
                        size="icon"
                        aria-label="Registrar resposta do lead"
                        aria-pressed={modoComposicao === "resposta"}
                        title="Registrar resposta do lead"
                        disabled={enviando}
                        onClick={() => {
                          if (modoComposicao !== "resposta") trocarModoComposicao("resposta")
                        }}
                      >
                        <MessageSquareReply className="size-4" />
                      </Button>
                      {modoComposicao !== "mensagem" ? (
                        <>
                          <Button type="button" variant="ghost" size="icon" aria-label="Cancelar registro" title="Cancelar registro" disabled={enviando} onClick={() => trocarModoComposicao("mensagem")}>
                            <X className="size-4" />
                          </Button>
                          <span className="ml-auto text-[11px] text-amber-700 dark:text-amber-300">
                            {modoComposicao === "nota" ? "Somente para a equipe" : "Registro manual · não será enviado"}
                          </span>
                        </>
                      ) : instancias.length ? (
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
                        maxLength={limiteTexto}
                        placeholder={modoComposicao === "nota" ? "Escreva uma nota interna..." : modoComposicao === "resposta" ? "Registre o que o lead respondeu..." : `Escreva uma mensagem para ${conversaAtiva.nome}...`}
                        className="min-h-12 max-h-32 resize-y bg-muted/40"
                        aria-label={modoComposicao === "nota" ? "Nota interna" : modoComposicao === "resposta" ? "Resposta do lead" : "Mensagem para o lead"}
                        disabled={enviando}
                      />
                      <Button size="icon" onClick={() => void enviarMensagem()} disabled={enviando || !texto.trim()} aria-label={modoComposicao === "nota" ? "Salvar nota interna" : modoComposicao === "resposta" ? "Registrar resposta" : "Enviar mensagem"} title={modoComposicao === "nota" ? "Salvar nota interna" : modoComposicao === "resposta" ? "Registrar resposta" : "Enviar mensagem"}>
                        {modoComposicao === "nota" ? <StickyNote className="size-4" /> : modoComposicao === "resposta" ? <CheckCheck className="size-4" /> : <Send className="size-4" />}
                      </Button>
                    </div>
                    <div className="mt-1 flex justify-between px-1 text-[10px] text-muted-foreground">
                      <span>Enter para {modoComposicao === "nota" ? "salvar nota" : modoComposicao === "resposta" ? "registrar resposta" : "enviar"} · Shift+Enter para nova linha</span>
                      <span className="tabular-nums">{texto.length}/{limiteTexto}</span>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="perfil" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                  <div className="mx-auto flex max-w-2xl flex-col gap-6">
                    <div className="flex items-center gap-4">
                      <Avatar className="size-14 shrink-0">
                        <AvatarFallback className="bg-primary/15 text-base font-semibold text-primary">{iniciais(conversaAtiva.nome)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold">{conversaAtiva.nome}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{conversaAtiva.telefone}</p>
                        <Badge variant="secondary" className="mt-2 capitalize">{conversaAtiva.status.replaceAll("_", " ")}</Badge>
                      </div>
                    </div>
                    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 border-y py-5 sm:grid-cols-2">
                      <CampoPerfil rotulo="Produto" valor={conversaAtiva.produto} />
                      <CampoPerfil rotulo="Marca" valor={conversaAtiva.marca} />
                      <CampoPerfil rotulo="Persona" valor={conversaAtiva.persona} />
                      <CampoPerfil rotulo="Região" valor={conversaAtiva.regiao} />
                      <CampoPerfil rotulo="Negócio" valor={conversaAtiva.negocio} />
                      <CampoPerfil rotulo="Atividade" valor={conversaAtiva.atividade} />
                    </dl>
                    <LinkButton variant="outline" className="w-fit" href={`/leads/${conversaAtiva.id}`}>
                      Ver cadastro completo
                    </LinkButton>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <MessageCircle className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {conversas.length ? "Selecione um lead para abrir uma conversa." : "Cadastre um lead para começar uma conversa."}
              </p>
              {!conversas.length ? <LinkButton variant="outline" href="/leads">Ver leads</LinkButton> : null}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

function CampoPerfil({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-1 wrap-break-word text-sm font-medium">{valor?.trim() || "Não informado"}</dd>
    </div>
  )
}
