"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { ArrowLeft, CheckCheck, Filter, Megaphone, MessageCircle, MessagesSquare, MessageSquareReply, Search, Send, Smile, StickyNote, UserRound, X } from "lucide-react"

import { createChatInternalNoteAction, loadChatMessagesAction, refreshChatInboxAction } from "@/app/actions/chat"
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

const INTERVALO_ATUALIZACAO = 8000
const LIMITE_MENSAGEM = 4096
const LIMITE_NOTA_INTERNA = 5000
const CHAVE_VISTAS = "chat-conversas-vistas"
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

function mesmoDia(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function rotuloDia(data: string) {
  const agora = new Date()
  const ontem = new Date()
  ontem.setDate(agora.getDate() - 1)
  const alvo = new Date(data)
  if (alvo.toDateString() === agora.toDateString()) return "Hoje"
  if (alvo.toDateString() === ontem.toDateString()) return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(alvo)
}

function dataLista(data: string) {
  const agora = new Date()
  const ontem = new Date()
  ontem.setDate(agora.getDate() - 1)
  const alvo = new Date(data)
  if (alvo.toDateString() === agora.toDateString()) return horario(data)
  if (alvo.toDateString() === ontem.toDateString()) return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(alvo)
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
  const [instancia, setInstancia] = useState(instancias[0]?.nome ?? "")
  const [enviando, setEnviando] = useState(false)
  const [vistas, setVistas] = useState<Record<string, string>>({})
  const [vistasCarregadas, setVistasCarregadas] = useState(false)
  const limiteTexto = modoComposicao === "nota" ? LIMITE_NOTA_INTERNA : LIMITE_MENSAGEM
  const conversaAtiva = conversas.find((conversa) => conversa.id === conversaSelecionadaId) ?? null
  const idSelecionadoRef = useRef(conversaSelecionadaId)
  const areaMensagensRef = useRef<HTMLDivElement | null>(null)
  const pertoDoFimRef = useRef(true)
  const conversaDoScrollRef = useRef<string | null>(null)
  const ultimoIdRef = useRef<string | null>(null)
  const assinaturaConversasRef = useRef(JSON.stringify(inicial.conversas))
  const assinaturaMensagensRef = useRef(JSON.stringify(inicial.mensagens))
  const cacheMensagensRef = useRef(new Map<string, ChatMessage[]>())

  // Ao (re)montar a área de mensagens — abrir a conversa ou voltar da aba Perfil — ela começa no fim.
  const definirAreaMensagens = useCallback((elemento: HTMLDivElement | null) => {
    areaMensagensRef.current = elemento
    if (elemento) {
      elemento.scrollTop = elemento.scrollHeight
      pertoDoFimRef.current = true
    }
  }, [])

  const conversasVisiveis = conversas.filter((conversa) => {
    const correspondeBusca = `${conversa.nome} ${conversa.telefone} ${conversa.produto}`.toLowerCase().includes(busca.toLowerCase())
    return correspondeBusca && (!somenteRespostas || conversa.ultimaMensagem?.lado === "lead")
  })
  const totalComResposta = conversas.filter((conversa) => conversa.ultimaMensagem?.lado === "lead").length
  const opcoesInstancia = instancias.map((item) => ({ value: item.nome, label: `${item.nome} · ${item.estado}` }))

  useEffect(() => {
    idSelecionadoRef.current = conversaSelecionadaId
  }, [conversaSelecionadaId])

  useEffect(() => {
    // Recupera até onde cada conversa já foi vista neste navegador.
    try {
      const salvo = window.localStorage.getItem(CHAVE_VISTAS)
      if (salvo) setVistas(JSON.parse(salvo) as Record<string, string>)
    } catch {
      // Sem acesso ao armazenamento: o aviso some apenas até recarregar a página.
    }
    setVistasCarregadas(true)
  }, [])

  const idAberto = conversaAtiva?.id ?? null
  const dataUltimaAberta = conversaAtiva?.ultimaMensagem?.data ?? null

  useEffect(() => {
    // Conversa aberta = mensagens vistas, inclusive as que chegam com ela aberta.
    if (!vistasCarregadas || !idAberto || !dataUltimaAberta) return
    setVistas((atual) => {
      if (atual[idAberto] && new Date(atual[idAberto]) >= new Date(dataUltimaAberta)) return atual
      const proximo = { ...atual, [idAberto]: dataUltimaAberta }
      try {
        window.localStorage.setItem(CHAVE_VISTAS, JSON.stringify(proximo))
      } catch {
        // Ignora falhas de armazenamento.
      }
      return proximo
    })
  }, [vistasCarregadas, idAberto, dataUltimaAberta])

  useEffect(() => {
    // No celular a lista ocupa a tela inteira; a conversa abre ao tocar em um lead.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      idSelecionadoRef.current = null
      setConversaSelecionadaId(null)
      setConversaFechada(true)
      mostrarMensagens([])
    }
  }, [])

  useEffect(() => {
    let ativo = true
    let timer: ReturnType<typeof setTimeout> | undefined

    async function atualizar() {
      clearTimeout(timer)
      // Com a aba em segundo plano não há por que consultar o banco.
      if (document.visibilityState === "visible") {
        try {
          const snapshot = await refreshChatInboxAction(conversaSelecionadaId, conversaFechada)
          if (ativo && idSelecionadoRef.current === conversaSelecionadaId) {
            const mesmaConversa = snapshot.conversaSelecionadaId === conversaSelecionadaId
            aplicarSnapshot(snapshot, !conversaFechada && (mesmaConversa || !conversaSelecionadaId))
            if (!conversaSelecionadaId && snapshot.conversaSelecionadaId && !conversaFechada) {
              setConversaSelecionadaId(snapshot.conversaSelecionadaId)
            }
          }
        } catch {
          // A próxima atualização tenta novamente sem interromper a conversa aberta.
        }
      }
      if (ativo) timer = setTimeout(atualizar, INTERVALO_ATUALIZACAO)
    }

    function aoVoltarParaAba() {
      if (document.visibilityState === "visible") void atualizar()
    }

    timer = setTimeout(atualizar, INTERVALO_ATUALIZACAO)
    document.addEventListener("visibilitychange", aoVoltarParaAba)
    return () => {
      ativo = false
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", aoVoltarParaAba)
    }
  }, [conversaFechada, conversaSelecionadaId])

  useEffect(() => {
    // Só rola quando faz sentido: ao trocar de conversa, ou quando chega mensagem
    // nova e a pessoa já está no fim. Atualizações sem novidade não mexem na rolagem.
    const area = areaMensagensRef.current
    if (!area || mensagens.length === 0) return
    const ultimoId = mensagens[mensagens.length - 1].id
    const trocouDeConversa = conversaDoScrollRef.current !== conversaSelecionadaId
    const chegouMensagemNova = ultimoIdRef.current !== ultimoId
    conversaDoScrollRef.current = conversaSelecionadaId
    ultimoIdRef.current = ultimoId

    if (trocouDeConversa) {
      area.scrollTop = area.scrollHeight
      pertoDoFimRef.current = true
    } else if (chegouMensagemNova && pertoDoFimRef.current) {
      area.scrollTo({ top: area.scrollHeight, behavior: "smooth" })
    }
  }, [mensagens, conversaSelecionadaId])

  function aoRolarMensagens() {
    const area = areaMensagensRef.current
    if (!area) return
    pertoDoFimRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 120
  }

  /** Só troca o estado quando o conteúdo realmente mudou (evita re-render e salto na tela). */
  function mostrarMensagens(lista: ChatMessage[]) {
    const assinatura = JSON.stringify(lista)
    if (assinatura === assinaturaMensagensRef.current) return
    assinaturaMensagensRef.current = assinatura
    setMensagens(lista)
  }

  function aplicarSnapshot(snapshot: ChatInboxSnapshot, comMensagens: boolean) {
    const assinatura = JSON.stringify(snapshot.conversas)
    if (assinatura !== assinaturaConversasRef.current) {
      assinaturaConversasRef.current = assinatura
      setConversas(snapshot.conversas)
    }
    if (comMensagens && snapshot.conversaSelecionadaId) {
      cacheMensagensRef.current.set(snapshot.conversaSelecionadaId, snapshot.mensagens)
      mostrarMensagens(snapshot.mensagens)
    }
  }

  async function selecionarConversa(id: string) {
    idSelecionadoRef.current = id
    setConversaFechada(false)
    setConversaSelecionadaId(id)
    // Conversa já aberta antes aparece na hora; o histórico novo chega logo depois.
    mostrarMensagens(cacheMensagensRef.current.get(id) ?? [])
    try {
      const lista = await loadChatMessagesAction(id)
      cacheMensagensRef.current.set(id, lista)
      if (idSelecionadoRef.current === id) mostrarMensagens(lista)
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
        : await sendLeadMessageAction(leadId, mensagem, instancia || null)
    setEnviando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    setTexto("")
    if (modoComposicao === "resposta") setModoComposicao("mensagem")
    toast.success(resultado.message)
    pertoDoFimRef.current = true
    try {
      const snapshot = await refreshChatInboxAction(leadId)
      aplicarSnapshot(snapshot, idSelecionadoRef.current === leadId)
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

  function sairDaConversa() {
    idSelecionadoRef.current = null
    setConversaSelecionadaId(null)
    setConversaFechada(true)
    mostrarMensagens([])
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
    <div className="flex h-[calc(100svh-6.5rem)] min-h-176 flex-col gap-3 lg:min-h-144">      

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <aside className={cn("min-h-0 flex-col bg-card lg:flex lg:border-r", conversaAtiva ? "hidden" : "flex")}>
          <div className="flex min-h-18 items-center justify-between gap-2 border-b bg-card px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Leads e conversas</h2>
              <p className="text-xs text-muted-foreground">{conversas.length} leads cadastrados</p>
            </div>
            <Button
              variant={somenteRespostas ? "secondary" : "ghost"}
              size="icon"
              className="rounded-full"
              aria-label="Alternar filtro de respostas"
              aria-pressed={somenteRespostas}
              title="Alternar filtro de respostas"
              onClick={() => setSomenteRespostas((atual) => !atual)}
            >
              <Filter className="size-4" />
            </Button>
          </div>
          <div className="px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar lead..."
                className="h-7 rounded-lg border-transparent bg-muted pl-9 focus-visible:bg-card"
                aria-label="Buscar leads"
              />
            </div>
          </div>
          <div className="flex gap-1.5 px-3 pb-2">
            <Button
              variant="ghost"
              size="sm"
              className={cn("rounded-full border", !somenteRespostas ? "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20" : "text-muted-foreground")}
              onClick={() => setSomenteRespostas(false)}
            >
              Todos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("rounded-full border", somenteRespostas ? "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20" : "text-muted-foreground")}
              onClick={() => setSomenteRespostas(true)}
            >
              Com resposta <span className="ml-1 tabular-nums">{totalComResposta}</span>
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversasVisiveis.length ? conversasVisiveis.map((conversa) => {
              const respondeu = conversa.ultimaMensagem?.lado === "lead"
              const naoLida = respondeu && vistasCarregadas && conversaSelecionadaId !== conversa.id &&
                (!vistas[conversa.id] || new Date(conversa.ultimaMensagem!.data) > new Date(vistas[conversa.id]))
              return (
                <button
                  key={conversa.id}
                  type="button"
                  onClick={() => void selecionarConversa(conversa.id)}
                  className={cn("group flex w-full items-center gap-3.5 px-4 text-left transition-colors hover:bg-muted/60", conversaSelecionadaId === conversa.id && "bg-muted")}
                >
                  <Avatar className="size-10 shrink-0">
                    <AvatarFallback className={cn("text-sm font-semibold", respondeu ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      {iniciais(conversa.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 border-b py-4 group-last:border-b-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-base font-medium">{conversa.nome}</span>
                      <span
                        className={cn("shrink-0 text-[11px]", naoLida ? "font-medium text-primary" : "text-muted-foreground")}
                        title={conversa.ultimaMensagem ? formatRelative(conversa.ultimaMensagem.data) : undefined}
                        suppressHydrationWarning
                      >
                        {conversa.ultimaMensagem ? dataLista(conversa.ultimaMensagem.data) : "Novo"}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                        {conversa.ultimaMensagem?.lado === "equipe" ? <CheckCheck className="size-4 shrink-0" /> : null}
                        {conversa.ultimaMensagem?.lado === "interno" ? <StickyNote className="size-3.5 shrink-0" /> : null}
                        <span className="truncate">{preview(conversa.ultimaMensagem)}</span>
                      </span>
                      {naoLida ? <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-label="Resposta não lida" /> : null}
                    </span>
                  </span>
                </button>
              )
            }) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum lead encontrado.</p>
            )}
          </div>
        </aside>

        <section className={cn("min-h-0 min-w-0 flex-col lg:flex", conversaAtiva ? "flex" : "hidden")}>
          {conversaAtiva ? (
            <>
              <header className="flex min-h-18 items-center justify-between gap-3 border-b bg-card px-3 py-2.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <Button variant="ghost" size="icon" className="-ml-1 rounded-full lg:hidden" aria-label="Voltar para a lista de conversas" title="Voltar" onClick={sairDaConversa}>
                    <ArrowLeft className="size-5" />
                  </Button>
                  <Avatar className="size-10 shrink-0"><AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">{iniciais(conversaAtiva.nome)}</AvatarFallback></Avatar>
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-semibold leading-tight">{conversaAtiva.nome}</h2>
                    <p className="truncate text-xs text-muted-foreground">{conversaAtiva.telefone}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="Sair da conversa" title="Sair da conversa" onClick={sairDaConversa}>
                    <X className="size-4" />
                  </Button>
                </div>
              </header>

              {conversaAtiva.campanhasNomes.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 border-y border-primary/20 bg-primary/10 px-4 py-2">
                  <Megaphone className="size-4 shrink-0 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Campanha vinculada</span>
                  {conversaAtiva.campanhasNomes.map((nome) => (
                    <Badge key={nome} className="max-w-full">
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
                <TabsList className="h-11 w-full justify-start rounded-none border-b bg-card px-3">
                  <TabsTrigger value="conversa"><MessagesSquare className="size-4" />Conversa</TabsTrigger>
                  <TabsTrigger value="perfil"><UserRound className="size-4" />Perfil</TabsTrigger>
                </TabsList>
                <TabsContent value="conversa" className="flex min-h-0 flex-1 flex-col">
                  <div ref={definirAreaMensagens} onScroll={aoRolarMensagens} className="wa-wallpaper flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 lg:px-12">
                    {mensagens.length ? mensagens.map((mensagem, indice) => {
                      const anterior = indice > 0 ? mensagens[indice - 1] : null
                      const novoDia = !anterior || !mesmoDia(anterior.data, mensagem.data)
                      const inicioDoGrupo = novoDia || anterior?.lado !== mensagem.lado
                      const interna = mensagem.lado === "interno"
                      const enviada = mensagem.lado === "equipe"
                      return (
                        <div key={mensagem.id} className="flex flex-col">
                          {novoDia ? (
                            <span className="my-4 self-center rounded-full border bg-(--wa-pill) px-4 py-1 text-xs text-(--wa-pill-fg) shadow-sm" suppressHydrationWarning>
                              {rotuloDia(mensagem.data)}
                            </span>
                          ) : null}
                          <div
                            className={cn(
                              "flex max-w-[92%] flex-col sm:max-w-[78%]",
                              inicioDoGrupo && !novoDia && "mt-4",
                              !inicioDoGrupo && "mt-1",
                              enviada ? "self-end" : interna ? "w-full max-w-[92%] self-center sm:max-w-[80%]" : "self-start",
                            )}
                          >
                            <div
                              className={cn(
                                "wa-bubble chat-message-content",
                                enviada ? "wa-bubble-out" : interna ? "wa-bubble-note" : "wa-bubble-in",
                              )}
                              style={{ fontFamily: 'var(--font-sans), "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' }}
                            >
                              {interna ? (
                                <span className="mb-0.5 flex items-center gap-1 text-xs font-semibold"><StickyNote className="size-3" />Nota interna</span>
                              ) : null}
                              {mensagem.campanhaNome ? (
                                <span className="mb-0.5 block max-w-56 truncate text-xs font-semibold text-primary">{mensagem.campanhaNome}</span>
                              ) : null}
                              <span className="whitespace-pre-wrap wrap-break-word">{mensagem.texto || "(mensagem sem texto)"}</span>
                              <span className="relative top-1 float-right ml-3 mt-1 flex items-center gap-1 text-[11px] leading-none text-(--wa-meta)" suppressHydrationWarning>
                                {horario(mensagem.data)}
                                {enviada ? <CheckCheck className="size-3.5" /> : interna ? <StickyNote className="size-3" /> : <MessageCircle className="size-3" />}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    }) : (
                      <div className="m-auto flex max-w-sm flex-col items-center gap-2 rounded-lg bg-(--wa-pill) px-6 py-8 text-center shadow-sm">
                        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircle className="size-5" /></span>
                        <p className="text-sm font-medium">Inicie a conversa com {conversaAtiva.nome}</p>
                        <p className="text-xs text-muted-foreground">As mensagens enviadas e as respostas recebidas aparecerão aqui.</p>
                      </div>
                    )}
                  </div>

                  <div className={cn("border-t px-4 py-4 sm:px-6", modoComposicao === "mensagem" ? "bg-card" : "bg-amber-50 dark:bg-amber-950/25")}>
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <Popover open={seletorEmojiAberto} onOpenChange={setSeletorEmojiAberto}>
                        <PopoverTrigger
                          render={
                            <Button variant="ghost" size="icon" className="rounded-full" disabled={enviando} aria-label="Abrir emojis" title="Inserir emoji">
                              <Smile className="size-5" />
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
                        className="rounded-full"
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
                        className="rounded-full"
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
                          <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Cancelar registro" title="Cancelar registro" disabled={enviando} onClick={() => trocarModoComposicao("mensagem")}>
                            <X className="size-4" />
                          </Button>
                          <span className="ml-auto text-[11px] font-medium text-amber-800 dark:text-amber-300">
                            {modoComposicao === "nota" ? "Somente para a equipe" : "Registro manual · não será enviado"}
                          </span>
                        </>
                      ) : instancias.length ? (
                        <SelectField
                          value={instancia}
                          onValueChange={setInstancia}
                          opcoes={opcoesInstancia}
                          size="sm"
                          className="ml-auto w-auto min-w-40 max-w-56 rounded-full bg-card"
                          disabled={enviando}
                        />
                      ) : <span className="ml-auto text-[11px] text-muted-foreground">Crie uma instância em Instâncias para enviar</span>}
                    </div>
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={texto}
                        onChange={(event) => setTexto(event.target.value)}
                        onKeyDown={tratarTecla}
                        maxLength={limiteTexto}
                        placeholder={modoComposicao === "nota" ? "Escreva uma nota interna..." : modoComposicao === "resposta" ? "Registre o que o lead respondeu..." : `Escreva uma mensagem para ${conversaAtiva.nome}...`}
                        className="max-h-48 min-h-14 resize-none rounded-2xl border-input bg-muted/50 px-5 py-4 text-base leading-snug md:text-base dark:bg-muted/40"
                        aria-label={modoComposicao === "nota" ? "Nota interna" : modoComposicao === "resposta" ? "Resposta do lead" : "Mensagem para o lead"}
                        disabled={enviando}
                      />
                      <Button
                        size="icon"
                        className="size-14 shrink-0 rounded-full"
                        onClick={() => void enviarMensagem()}
                        disabled={enviando || !texto.trim() || (modoComposicao === "mensagem" && instancias.length === 0)}
                        aria-label={modoComposicao === "nota" ? "Salvar nota interna" : modoComposicao === "resposta" ? "Registrar resposta" : "Enviar mensagem"}
                        title={modoComposicao === "nota" ? "Salvar nota interna" : modoComposicao === "resposta" ? "Registrar resposta" : "Enviar mensagem"}
                      >
                        {modoComposicao === "nota" ? <StickyNote className="size-5" /> : modoComposicao === "resposta" ? <CheckCheck className="size-5" /> : <Send className="size-6" />}
                      </Button>
                    </div>
                    <div className="mt-2 flex justify-between gap-3 px-2 text-[11px] text-muted-foreground">
                      <span>Enter para {modoComposicao === "nota" ? "salvar nota" : modoComposicao === "resposta" ? "registrar resposta" : "enviar"} · Shift+Enter para nova linha</span>
                      <span className="shrink-0 tabular-nums">{texto.length}/{limiteTexto}</span>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="perfil" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                  <div className="mx-auto flex max-w-2xl flex-col gap-6">
                    <div className="flex items-center gap-4">
                      <Avatar className="size-16 shrink-0">
                        <AvatarFallback className="bg-primary/15 text-lg font-semibold text-primary">{iniciais(conversaAtiva.nome)}</AvatarFallback>
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
            <div className="wa-wallpaper flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex flex-col items-center gap-3 rounded-lg bg-(--wa-pill) px-8 py-8 shadow-sm">
                <MessageCircle className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {conversas.length ? "Selecione um lead para abrir uma conversa." : "Cadastre um lead para começar uma conversa."}
                </p>
                {!conversas.length ? <LinkButton variant="outline" href="/leads">Ver leads</LinkButton> : null}
              </div>
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
