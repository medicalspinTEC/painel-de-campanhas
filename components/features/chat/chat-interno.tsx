"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { ArrowLeft, CheckCheck, Download, FileText, ImageIcon, LogOut, MessageCircle, Paperclip, Pencil, Plus, Search, Send, Settings, Trash2, UserMinus, UserPlus, Users, X } from "lucide-react"

import {
  abrirConversaInternaAction,
  adicionarMembrosGrupoInternoAction,
  criarGrupoInternoAction,
  enviarMensagemInternaAction,
  excluirGrupoInternoAction,
  loadChatInternoMensagensAction,
  refreshChatInternoAction,
  removerMembroGrupoInternoAction,
  renomearGrupoInternoAction,
  sairDoGrupoInternoAction,
} from "@/app/actions/chat-interno"
import { ChatAbas } from "@/components/features/chat/chat-abas"
import { useChatAbas } from "@/components/features/chat/chat-shell"
import { UserAvatar } from "@/components/shared/user-avatar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { InternoContato, InternoConversaDto, InternoMensagemDto, InternoSnapshot } from "@/services/chat-interno"

const INTERVALO_ATUALIZACAO = 5000
const LIMITE_TEXTO = 4096
/** Igual ao limite do servidor (lib/interno-storage.ts). */
const LIMITE_ARQUIVO_BYTES = 16 * 1024 * 1024

function iniciais(nome: string) {
  return nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
}

function horario(data: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data))
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

function tamanhoLegivel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function AvatarNome({
  nome,
  grupo = false,
  className,
  userId,
  fotoEm,
}: {
  nome: string
  grupo?: boolean
  className?: string
  /** Usuário da conversa direta / contato: mostra a foto de perfil quando houver. */
  userId?: string
  fotoEm?: number | null
}) {
  if (userId && !grupo) {
    return (
      <UserAvatar
        userId={userId}
        nome={nome}
        fotoEm={fotoEm}
        className={cn("size-10 shrink-0", className)}
        fallbackClassName="bg-primary/15 text-sm font-semibold text-primary"
      />
    )
  }
  return (
    <Avatar className={cn("size-10 shrink-0", className)}>
      <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
        {grupo ? <Users className="size-4" /> : iniciais(nome)}
      </AvatarFallback>
    </Avatar>
  )
}

/** O outro participante de uma conversa direta (nulo em grupo). */
function outroDaConversa(conversa: InternoConversaDto, usuarioId: string) {
  return conversa.tipo === "grupo" ? undefined : conversa.participantes.find((p) => p.id !== usuarioId)
}

function previewLista(conversa: InternoConversaDto) {
  const ultima = conversa.ultimaMensagem
  if (!ultima) return "Nenhuma mensagem ainda"
  const prefixo = ultima.minha ? "Você: " : conversa.tipo === "grupo" ? `${ultima.autorNome.split(" ")[0]}: ` : ""
  return `${prefixo}${ultima.texto}`
}

export function ChatInterno({ inicial, usuarioId }: { inicial: InternoSnapshot; usuarioId: string }) {
  const [conversas, setConversas] = useState(inicial.conversas)
  const [contatos, setContatos] = useState(inicial.contatos)
  const [selecionadaId, setSelecionadaId] = useState<string | null>(inicial.conversaSelecionadaId)
  const [mensagens, setMensagens] = useState<InternoMensagemDto[]>(inicial.mensagens)
  const [temMais, setTemMais] = useState(inicial.temMais)
  const [carregando, setCarregando] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [busca, setBusca] = useState("")
  const [texto, setTexto] = useState("")
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [novaAberta, setNovaAberta] = useState(false)
  const [configAberta, setConfigAberta] = useState(false)
  // Anexos que acabaram de ser baixados por mim (o servidor registra o fim do download).
  const [baixados, setBaixados] = useState<Set<string>>(new Set())

  const selecionadaRef = useRef(selecionadaId)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const pertoDoFimRef = useRef(true)
  const ultimoIdRef = useRef<string | null>(null)
  const conversaDoScrollRef = useRef<string | null>(null)
  const inputArquivoRef = useRef<HTMLInputElement | null>(null)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  // Última página vista de cada conversa: reabrir mostra na hora e atualiza por baixo.
  const cacheRef = useRef(new Map<string, { mensagens: InternoMensagemDto[]; temMais: boolean }>())
  const mensagensRef = useRef(mensagens)
  const alturaAntesRef = useRef<number | null>(null)

  const conversaAtiva = conversas.find((c) => c.id === selecionadaId) ?? null
  const totalNaoLidas = conversas.reduce((soma, c) => soma + c.naoLidas, 0)

  // O selo da aba "Equipe" (também visível na aba Leads) acompanha o total de não lidas daqui.
  const abas = useChatAbas()
  const definirNaoLidasEquipe = abas?.definirNaoLidasEquipe
  useEffect(() => {
    definirNaoLidasEquipe?.(totalNaoLidas)
  }, [definirNaoLidasEquipe, totalNaoLidas])

  const conversasVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return conversas
    return conversas.filter((c) => c.nome.toLowerCase().includes(termo))
  }, [busca, conversas])

  useEffect(() => {
    mensagensRef.current = mensagens
    if (selecionadaId && mensagens.length) cacheRef.current.set(selecionadaId, { mensagens, temMais })
  }, [mensagens, temMais, selecionadaId])

  // Ao carregar mensagens anteriores, mantém a posição de leitura (não pula para o topo).
  useLayoutEffect(() => {
    const area = areaRef.current
    if (area && alturaAntesRef.current !== null) {
      area.scrollTop = area.scrollHeight - alturaAntesRef.current
      alturaAntesRef.current = null
    }
  }, [mensagens])

  /** Junta a página mais recente (do servidor) ao que já está na tela, sem perder as mais antigas. */
  const mesclarRecentes = useCallback((recentes: InternoMensagemDto[], haMais: boolean) => {
    setMensagens((atual) => {
      if (recentes.length === 0) return atual
      const corte = recentes[0].data
      const antigas = atual.filter((m) => m.data < corte)
      return antigas.length ? [...antigas, ...recentes] : recentes
    })
    setTemMais((atual) => (mensagensRef.current.some((m) => m.data < recentes[0]?.data) ? atual : haMais))
  }, [])

  const aplicar = useCallback((snapshot: InternoSnapshot, comMensagens: boolean) => {
    setConversas(snapshot.conversas)
    setContatos(snapshot.contatos)
    if (comMensagens) setMensagens(snapshot.mensagens)
  }, [])

  // Atualização periódica (só com a aba visível).
  useEffect(() => {
    let ativo = true
    let timer: ReturnType<typeof setTimeout> | undefined

    async function atualizar() {
      clearTimeout(timer)
      if (document.visibilityState === "visible") {
        const alvo = selecionadaRef.current
        try {
          // Só a lista (leve). O histórico só é buscado se a conversa aberta tiver novidade.
          const snapshot = await refreshChatInternoAction(alvo, true)
          if (!ativo) return
          aplicar(snapshot, false)
          // Removido do grupo (ou grupo excluído) enquanto a conversa estava aberta: volta para a lista.
          if (alvo && selecionadaRef.current === alvo && !snapshot.conversas.some((c) => c.id === alvo)) {
            selecionadaRef.current = null
            setSelecionadaId(null)
            setMensagens([])
            setConfigAberta(false)
            cacheRef.current.delete(alvo)
            toast.info("Esta conversa não está mais disponível para você.")
          } else if (alvo && selecionadaRef.current === alvo) {
            const conversa = snapshot.conversas.find((c) => c.id === alvo)
            const ultimaTela = mensagensRef.current[mensagensRef.current.length - 1]?.data
            if (conversa?.ultimaMensagem && conversa.ultimaMensagem.data !== ultimaTela) {
              const resposta = await loadChatInternoMensagensAction(alvo)
              if (ativo && resposta.ok && selecionadaRef.current === alvo) mesclarRecentes(resposta.mensagens, resposta.temMais)
            }
            // A conversa aberta nunca fica com contador de não lidas.
            setConversas((atual) => atual.map((c) => (c.id === alvo ? { ...c, naoLidas: 0 } : c)))
          }
        } catch {
          // A próxima rodada tenta de novo.
        }
      }
      if (ativo) timer = setTimeout(atualizar, INTERVALO_ATUALIZACAO)
    }

    function aoVoltar() {
      if (document.visibilityState === "visible") void atualizar()
    }

    timer = setTimeout(atualizar, INTERVALO_ATUALIZACAO)
    document.addEventListener("visibilitychange", aoVoltar)
    return () => {
      ativo = false
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", aoVoltar)
    }
  }, [aplicar, mesclarRecentes])

  // Rolagem: no fim ao abrir a conversa; acompanha mensagens novas só se a pessoa já estava no fim.
  useEffect(() => {
    const area = areaRef.current
    if (!area || mensagens.length === 0) return
    const ultimoId = mensagens[mensagens.length - 1].id
    const trocou = conversaDoScrollRef.current !== selecionadaId
    const chegouNova = ultimoIdRef.current !== ultimoId
    conversaDoScrollRef.current = selecionadaId
    ultimoIdRef.current = ultimoId
    if (trocou) {
      area.scrollTop = area.scrollHeight
      pertoDoFimRef.current = true
    } else if (chegouNova && pertoDoFimRef.current) {
      area.scrollTo({ top: area.scrollHeight, behavior: "smooth" })
    }
  }, [mensagens, selecionadaId])

  function aoRolar() {
    const area = areaRef.current
    if (area) pertoDoFimRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80
  }

  async function selecionar(id: string) {
    selecionadaRef.current = id
    setSelecionadaId(id)
    setTexto("")
    setArquivo(null)
    // Abrir a conversa zera o contador dela na hora.
    setConversas((atual) => atual.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)))
    // Já vista antes? Mostra o que tinha e atualiza por baixo. Senão, mostra o carregamento.
    const guardada = cacheRef.current.get(id)
    setMensagens(guardada?.mensagens ?? [])
    setTemMais(guardada?.temMais ?? false)
    setCarregando(!guardada)
    const resultado = await loadChatInternoMensagensAction(id)
    if (selecionadaRef.current !== id) return
    setCarregando(false)
    if (!resultado.ok) return toast.error(resultado.message)
    if (guardada) mesclarRecentes(resultado.mensagens, resultado.temMais)
    else {
      setMensagens(resultado.mensagens)
      setTemMais(resultado.temMais)
    }
  }

  async function carregarAnteriores() {
    if (!selecionadaId || carregandoMais || mensagens.length === 0) return
    const id = selecionadaId
    setCarregandoMais(true)
    try {
      const resultado = await loadChatInternoMensagensAction(id, mensagens[0].data)
      if (selecionadaRef.current !== id) return
      if (!resultado.ok) return toast.error(resultado.message)
      alturaAntesRef.current = areaRef.current?.scrollHeight ?? null
      setMensagens((atual) => {
        const conhecidas = new Set(atual.map((m) => m.id))
        return [...resultado.mensagens.filter((m) => !conhecidas.has(m.id)), ...atual]
      })
      setTemMais(resultado.temMais)
    } finally {
      setCarregandoMais(false)
    }
  }

  function voltarParaLista() {
    selecionadaRef.current = null
    setSelecionadaId(null)
    setMensagens([])
    setCarregando(false)
  }

  async function enviar() {
    if (!selecionadaId || enviando) return
    const textoLimpo = texto.trim()
    if (!textoLimpo && !arquivo) return
    if (textoLimpo.length > LIMITE_TEXTO) {
      toast.error(`A mensagem é muito longa (máximo de ${LIMITE_TEXTO} caracteres).`)
      return
    }
    setEnviando(true)
    const dados = new FormData()
    dados.append("texto", textoLimpo)
    if (arquivo) dados.append("arquivo", arquivo)
    const idDaConversa = selecionadaId
    try {
      const resultado = await enviarMensagemInternaAction(idDaConversa, dados)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      setTexto("")
      setArquivo(null)
      pertoDoFimRef.current = true
      if (selecionadaRef.current === idDaConversa) {
        setMensagens((atual) => (atual.some((m) => m.id === resultado.mensagem.id) ? atual : [...atual, resultado.mensagem]))
      }
      void refreshChatInternoAction(selecionadaRef.current, true).then((s) => aplicar(s, false)).catch(() => undefined)
      campoRef.current?.focus()
    } catch {
      toast.error("Não foi possível enviar. Verifique a conexão e tente de novo.")
    } finally {
      setEnviando(false)
    }
  }

  function aoTeclar(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void enviar()
    }
  }

  function escolherArquivo(novo: File | undefined) {
    if (!novo) return
    if (novo.size === 0) return toast.error("O arquivo está vazio.")
    if (novo.size > LIMITE_ARQUIVO_BYTES) return toast.error(`O arquivo é muito grande (máximo de ${LIMITE_ARQUIVO_BYTES / 1024 / 1024} MB).`)
    setArquivo(novo)
  }

  async function sairDoGrupo() {
    if (!conversaAtiva || conversaAtiva.tipo !== "grupo") return
    if (!window.confirm(`Sair do grupo "${conversaAtiva.nome}"?`)) return
    const resultado = await sairDoGrupoInternoAction(conversaAtiva.id)
    if (!resultado.ok) return toast.error(resultado.message)
    voltarParaLista()
    setConversas((atual) => atual.filter((c) => c.id !== conversaAtiva.id))
    toast.success("Você saiu do grupo.")
  }

  /** Recarrega a lista (nome, membros, permissões) depois de uma alteração no grupo. */
  async function atualizarLista() {
    try {
      aplicar(await refreshChatInternoAction(selecionadaRef.current, true), false)
    } catch {
      // A lista se atualiza na próxima rodada.
    }
  }

  function aoExcluirGrupo(conversaId: string) {
    setConfigAberta(false)
    cacheRef.current.delete(conversaId)
    voltarParaLista()
    setConversas((atual) => atual.filter((c) => c.id !== conversaId))
  }

  async function aoCriada(conversaId: string) {
    setNovaAberta(false)
    try {
      aplicar(await refreshChatInternoAction(conversaId, true), false)
    } catch {
      // A lista se atualiza na próxima rodada.
    }
    await selecionar(conversaId)
  }

  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-176 flex-col gap-3 lg:min-h-144">
      <ChatAbas ativa="equipe" naoLidasEquipe={totalNaoLidas} />

      <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Lista de conversas */}
        <aside className={cn("min-h-0 flex-col bg-card lg:flex lg:border-r", conversaAtiva ? "hidden" : "flex")}>
          <div className="flex min-h-18 items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Equipe</h2>
              <p className="text-xs text-muted-foreground">Conversas internas, fora do WhatsApp</p>
            </div>
            <Button size="icon" variant="ghost" className="rounded-full" aria-label="Nova conversa" title="Nova conversa" onClick={() => setNovaAberta(true)}>
              <Plus className="size-5" />
            </Button>
          </div>
          <div className="px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar conversa..."
                className="h-7 rounded-lg border-transparent bg-muted pl-9 focus-visible:bg-card"
                aria-label="Buscar conversas"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversasVisiveis.length ? (
              conversasVisiveis.map((conversa) => (
                <button
                  key={conversa.id}
                  type="button"
                  onClick={() => void selecionar(conversa.id)}
                  className={cn("flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-muted/60", selecionadaId === conversa.id && "bg-muted")}
                >
                  <AvatarNome nome={conversa.nome} grupo={conversa.tipo === "grupo"} userId={outroDaConversa(conversa, usuarioId)?.id} fotoEm={outroDaConversa(conversa, usuarioId)?.fotoEm} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] font-medium">{conversa.nome}</span>
                      <span className={cn("shrink-0 text-xs", conversa.naoLidas > 0 ? "font-semibold text-primary" : "text-muted-foreground")} suppressHydrationWarning>
                        {conversa.ultimaMensagem ? dataLista(conversa.ultimaMensagem.data) : ""}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-muted-foreground">{previewLista(conversa)}</span>
                      {conversa.naoLidas > 0 ? (
                        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
                          {conversa.naoLidas > 99 ? "99+" : conversa.naoLidas}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Users className="size-5" /></span>
                <p className="text-sm font-medium">{busca ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}</p>
                {!busca ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {contatos.length ? "Converse com um colega ou crie um grupo." : "Não há outros usuários com acesso ao chat."}
                    </p>
                    {contatos.length ? <Button size="sm" onClick={() => setNovaAberta(true)}><Plus className="size-4" />Nova conversa</Button> : null}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </aside>

        {/* Conversa aberta */}
        {conversaAtiva ? (
          <section className="flex min-h-0 min-w-0 flex-col">
            <header className="flex min-h-18 items-center gap-3 border-b bg-card px-3 py-3 sm:px-4">
              <Button variant="ghost" size="icon" className="rounded-full lg:hidden" aria-label="Voltar às conversas" onClick={voltarParaLista}>
                <ArrowLeft className="size-5" />
              </Button>
              <AvatarNome nome={conversaAtiva.nome} grupo={conversaAtiva.tipo === "grupo"} userId={outroDaConversa(conversaAtiva, usuarioId)?.id} fotoEm={outroDaConversa(conversaAtiva, usuarioId)?.fotoEm} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[15px] font-semibold leading-tight">{conversaAtiva.nome}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {conversaAtiva.tipo === "grupo"
                    ? conversaAtiva.participantes.map((p) => (p.id === usuarioId ? "Você" : p.nome)).join(", ")
                    : `@${conversaAtiva.participantes.find((p) => p.id !== usuarioId)?.username ?? ""}`}
                </p>
              </div>
              {conversaAtiva.tipo === "grupo" ? (
                <>
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="Configurações do grupo" title="Configurações do grupo" onClick={() => setConfigAberta(true)}>
                    <Settings className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="Sair do grupo" title="Sair do grupo" onClick={() => void sairDoGrupo()}>
                    <LogOut className="size-4" />
                  </Button>
                </>
              ) : null}
            </header>

            <div ref={areaRef} onScroll={aoRolar} className="wa-wallpaper flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 lg:px-12">
              {temMais && mensagens.length ? (
                <Button type="button" variant="secondary" size="sm" className="mb-2 self-center rounded-full" disabled={carregandoMais} onClick={() => void carregarAnteriores()}>
                  {carregandoMais ? "Carregando..." : "Ver mensagens anteriores"}
                </Button>
              ) : null}
              {carregando && mensagens.length === 0 ? (
                <div className="flex flex-1 flex-col gap-3" role="status" aria-label="Carregando mensagens">
                  {[["self-start", "w-48"], ["self-end", "w-60"], ["self-start", "w-64"], ["self-end", "w-40"]].map(([lado, largura], i) => (
                    <span key={i} className={cn("h-10 animate-pulse rounded-2xl bg-(--wa-pill)", lado, largura)} />
                  ))}
                </div>
              ) : mensagens.length ? (
                mensagens.map((mensagem, indice) => {
                  const anterior = mensagens[indice - 1]
                  const novoDia = !anterior || new Date(anterior.data).toDateString() !== new Date(mensagem.data).toDateString()
                  const minha = mensagem.autorId === usuarioId
                  const inicioDoGrupo = !anterior || novoDia || anterior.autorId !== mensagem.autorId
                  const anexo = mensagem.anexo
                  const baixou = anexo ? baixados.has(anexo.id) || anexo.baixadoPorMim : false
                  return (
                    <div key={mensagem.id} className="flex flex-col">
                      {novoDia ? (
                        <span className="my-4 self-center rounded-full border bg-(--wa-pill) px-4 py-1 text-xs text-(--wa-pill-fg) shadow-sm" suppressHydrationWarning>
                          {rotuloDia(mensagem.data)}
                        </span>
                      ) : null}
                      <div className={cn("flex max-w-[92%] flex-col sm:max-w-[78%]", inicioDoGrupo && !novoDia ? "mt-4" : !inicioDoGrupo && "mt-1", minha ? "self-end" : "self-start")}>
                        <div className={cn("wa-bubble chat-message-content", minha ? "wa-bubble-out" : "wa-bubble-in")}>
                          {!minha && conversaAtiva.tipo === "grupo" && inicioDoGrupo ? (
                            <span className="mb-0.5 block max-w-56 truncate text-xs font-semibold text-primary">{mensagem.autorNome}</span>
                          ) : null}
                          {anexo ? (
                            <span className="flex flex-col gap-1.5">
                              <span className="flex items-center gap-2.5">
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
                                  {anexo.tipo === "imagem" ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}
                                </span>
                                <span className="min-w-0">
                                  <span className="block max-w-56 truncate text-sm font-medium">{anexo.nome}</span>
                                  <span className="block text-xs text-muted-foreground">{tamanhoLegivel(anexo.tamanho)}</span>
                                </span>
                              </span>
                              {anexo.disponivel && !baixou ? (
                                <a
                                  href={`/api/chat/interno/arquivo/${anexo.id}`}
                                  download={anexo.nome}
                                  className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                                  onClick={() => {
                                    // Quem envia pode baixar a própria cópia sem consumir o arquivo dos outros.
                                    if (minha) return
                                    const id = anexo.id
                                    setTimeout(() => setBaixados((atual) => new Set(atual).add(id)), 1500)
                                  }}
                                >
                                  <Download className="size-3.5" />Baixar
                                </a>
                              ) : (
                                <span className="text-xs italic text-muted-foreground">
                                  {anexo.disponivel ? "Você já baixou este arquivo" : "Baixado e removido do servidor"}
                                </span>
                              )}
                            </span>
                          ) : null}
                          {mensagem.texto ? <span className="whitespace-pre-wrap wrap-break-word">{mensagem.texto}</span> : null}
                          <span className="relative top-1 float-right ml-3 mt-1 flex items-center gap-1 text-[11px] leading-none text-(--wa-meta)" suppressHydrationWarning>
                            {horario(mensagem.data)}
                            {minha ? <CheckCheck className="size-3.5" /> : null}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="m-auto flex max-w-sm flex-col items-center gap-2 rounded-lg bg-(--wa-pill) px-6 py-8 text-center shadow-sm">
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircle className="size-5" /></span>
                  <p className="text-sm font-medium">Comece a conversa com {conversaAtiva.nome}</p>
                  <p className="text-xs text-muted-foreground">Aqui fica só a equipe: nada disto é enviado pelo WhatsApp.</p>
                </div>
              )}
            </div>

            <footer className="border-t bg-card px-3 py-3 sm:px-4">
              {arquivo ? (
                <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{tamanhoLegivel(arquivo.size)}</span>
                  <Button type="button" variant="ghost" size="icon" className="size-6 rounded-full" aria-label="Remover arquivo" onClick={() => setArquivo(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <input
                  ref={inputArquivoRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    escolherArquivo(event.target.files?.[0])
                    event.target.value = ""
                  }}
                />
                <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Anexar imagem ou arquivo" title="Anexar imagem ou arquivo (apagado do servidor quando baixado)" disabled={enviando} onClick={() => inputArquivoRef.current?.click()}>
                  <Paperclip className="size-5" />
                </Button>
                <Textarea
                  ref={campoRef}
                  value={texto}
                  onChange={(event) => setTexto(event.target.value)}
                  onKeyDown={aoTeclar}
                  maxLength={LIMITE_TEXTO}
                  rows={1}
                  placeholder={arquivo ? "Legenda (opcional)" : "Mensagem para a equipe"}
                  aria-label="Mensagem"
                  className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl"
                  disabled={enviando}
                />
                <Button type="button" size="icon" className="shrink-0 rounded-full" aria-label="Enviar" disabled={enviando || (!texto.trim() && !arquivo)} onClick={() => void enviar()}>
                  <Send className="size-4" />
                </Button>
              </div>
            </footer>
          </section>
        ) : (
          <div className="wa-wallpaper hidden flex-1 flex-col items-center justify-center gap-3 p-6 text-center lg:flex">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Users className="size-6" /></span>
            <p className="text-base font-medium">Chat da equipe</p>
            <p className="max-w-xs text-sm text-muted-foreground">Converse com os colegas dentro da plataforma. Imagens e arquivos não ficam guardados: somem do servidor quando são baixados.</p>
            {contatos.length ? <Button onClick={() => setNovaAberta(true)}><Plus className="size-4" />Nova conversa</Button> : null}
          </div>
        )}
      </div>

      <NovaConversaDialog open={novaAberta} onOpenChange={setNovaAberta} contatos={contatos} onCriada={aoCriada} />
      {conversaAtiva?.tipo === "grupo" ? (
        <GrupoConfigDialog
          key={conversaAtiva.id}
          open={configAberta}
          onOpenChange={setConfigAberta}
          grupo={conversaAtiva}
          contatos={contatos}
          usuarioId={usuarioId}
          onAlterado={atualizarLista}
          onExcluido={() => aoExcluirGrupo(conversaAtiva.id)}
          onSaiu={() => {
            setConfigAberta(false)
            voltarParaLista()
            setConversas((atual) => atual.filter((c) => c.id !== conversaAtiva.id))
          }}
        />
      ) : null}
    </div>
  )
}

function NovaConversaDialog({
  open,
  onOpenChange,
  contatos,
  onCriada,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contatos: InternoContato[]
  onCriada: (conversaId: string) => void | Promise<void>
}) {
  const [grupo, setGrupo] = useState(false)
  const [nome, setNome] = useState("")
  const [busca, setBusca] = useState("")
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [pendente, setPendente] = useState(false)

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return termo ? contatos.filter((c) => c.nome.toLowerCase().includes(termo) || c.username.includes(termo)) : contatos
  }, [busca, contatos])

  function fechar(proximo: boolean) {
    if (pendente) return
    onOpenChange(proximo)
    if (!proximo) {
      setGrupo(false)
      setNome("")
      setBusca("")
      setMarcados(new Set())
    }
  }

  function alternar(id: string) {
    setMarcados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  async function abrirDireta(id: string) {
    setPendente(true)
    try {
      const resultado = await abrirConversaInternaAction(id)
      if (!resultado.ok) return toast.error(resultado.message)
      await onCriada(resultado.conversaId)
    } finally {
      setPendente(false)
    }
  }

  async function criarGrupo() {
    setPendente(true)
    try {
      const resultado = await criarGrupoInternoAction(nome, [...marcados])
      if (!resultado.ok) return toast.error(resultado.message)
      await onCriada(resultado.conversaId)
    } finally {
      setPendente(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{grupo ? "Novo grupo" : "Nova conversa"}</DialogTitle>
          <DialogDescription>
            {grupo ? "Escolha o nome e pelo menos 2 pessoas." : "Escolha com quem conversar. Fica só dentro da plataforma."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant={grupo ? "ghost" : "secondary"} className="rounded-full" onClick={() => setGrupo(false)}>Conversa direta</Button>
          <Button type="button" size="sm" variant={grupo ? "secondary" : "ghost"} className="rounded-full" onClick={() => setGrupo(true)}><Users className="size-4" />Grupo</Button>
        </div>

        {grupo ? <Input value={nome} onChange={(event) => setNome(event.target.value)} maxLength={60} placeholder="Nome do grupo" aria-label="Nome do grupo" /> : null}
        <Input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar pessoa..." aria-label="Buscar pessoa" />

        <div className="max-h-72 overflow-y-auto rounded-lg border">
          {visiveis.length ? (
            visiveis.map((contato) =>
              grupo ? (
                <label key={contato.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
                  <Checkbox checked={marcados.has(contato.id)} onCheckedChange={() => alternar(contato.id)} aria-label={contato.nome} />
                  <AvatarNome nome={contato.nome} userId={contato.id} fotoEm={contato.fotoEm} className="size-8" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{contato.nome}</span><span className="block truncate text-xs text-muted-foreground">@{contato.username}</span></span>
                </label>
              ) : (
                <button key={contato.id} type="button" disabled={pendente} onClick={() => void abrirDireta(contato.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 disabled:opacity-60">
                  <AvatarNome nome={contato.nome} userId={contato.id} fotoEm={contato.fotoEm} className="size-8" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{contato.nome}</span><span className="block truncate text-xs text-muted-foreground">@{contato.username}</span></span>
                </button>
              ),
            )
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{contatos.length ? "Ninguém encontrado." : "Não há outros usuários com acesso ao chat."}</p>
          )}
        </div>

        {grupo ? (
          <Button type="button" disabled={pendente || !nome.trim() || marcados.size < 2} onClick={() => void criarGrupo()}>
            {pendente ? "Criando..." : `Criar grupo${marcados.size ? ` (${marcados.size + 1} pessoas)` : ""}`}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function GrupoConfigDialog({
  open,
  onOpenChange,
  grupo,
  contatos,
  usuarioId,
  onAlterado,
  onExcluido,
  onSaiu,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  grupo: InternoConversaDto
  contatos: InternoContato[]
  usuarioId: string
  onAlterado: () => void | Promise<void>
  onExcluido: () => void
  onSaiu: () => void
}) {
  const [nome, setNome] = useState(grupo.nome)
  const [busca, setBusca] = useState("")
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [pendente, setPendente] = useState(false)
  const admin = grupo.podeAdministrar

  // Ao reabrir, volta ao nome atual do grupo.
  useEffect(() => {
    if (open) {
      setNome(grupo.nome)
      setBusca("")
      setMarcados(new Set())
    }
  }, [open, grupo.nome])

  const idsNoGrupo = useMemo(() => new Set(grupo.participantes.map((p) => p.id)), [grupo.participantes])
  const disponiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return contatos.filter((c) => !idsNoGrupo.has(c.id) && (!termo || c.nome.toLowerCase().includes(termo) || c.username.includes(termo)))
  }, [busca, contatos, idsNoGrupo])

  async function rodar(acao: () => Promise<{ ok: boolean; message?: string }>, sucesso: string, aoOk?: () => void) {
    setPendente(true)
    try {
      const resultado = await acao()
      if (!resultado.ok) return toast.error(resultado.message ?? "Não foi possível concluir.")
      toast.success(sucesso)
      if (aoOk) aoOk()
      else await onAlterado()
    } catch {
      toast.error("Não foi possível concluir. Verifique a conexão e tente de novo.")
    } finally {
      setPendente(false)
    }
  }

  function alternar(id: string) {
    setMarcados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  const nomeAlterado = nome.trim() !== grupo.nome && nome.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(proximo) => (pendente ? undefined : onOpenChange(proximo))}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurações do grupo</DialogTitle>
          <DialogDescription>
            {admin ? "Altere o nome, gerencie as pessoas ou exclua o grupo." : "Só quem criou o grupo pode alterá-lo. Você pode ver quem participa e sair."}
          </DialogDescription>
        </DialogHeader>

        {/* Nome */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="grupo-nome">Nome do grupo</label>
          <div className="flex gap-2">
            <Input id="grupo-nome" value={nome} onChange={(event) => setNome(event.target.value)} maxLength={60} disabled={!admin || pendente} />
            {admin ? (
              <Button
                type="button"
                disabled={pendente || !nomeAlterado}
                onClick={() => void rodar(() => renomearGrupoInternoAction(grupo.id, nome), "Nome do grupo alterado.")}
              >
                <Pencil className="size-4" />Salvar
              </Button>
            ) : null}
          </div>
        </div>

        {/* Participantes */}
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Participantes ({grupo.participantes.length})</p>
          <div className="max-h-52 overflow-y-auto rounded-lg border">
            {grupo.participantes.map((pessoa) => (
              <div key={pessoa.id} className="flex items-center gap-3 px-3 py-2">
                <AvatarNome nome={pessoa.nome} userId={pessoa.id} fotoEm={pessoa.fotoEm} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{pessoa.id === usuarioId ? `${pessoa.nome} (você)` : pessoa.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{pessoa.username}</span>
                </span>
                {admin && pessoa.id !== usuarioId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full text-destructive hover:text-destructive"
                    aria-label={`Remover ${pessoa.nome} do grupo`}
                    title="Remover do grupo"
                    disabled={pendente}
                    onClick={() => {
                      if (!window.confirm(`Remover ${pessoa.nome} do grupo?`)) return
                      void rodar(() => removerMembroGrupoInternoAction(grupo.id, pessoa.id), `${pessoa.nome} foi removido(a) do grupo.`)
                    }}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Adicionar */}
        {admin ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Adicionar pessoas</p>
            {contatos.some((c) => !idsNoGrupo.has(c.id)) ? (
              <>
                <Input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar pessoa..." aria-label="Buscar pessoa para adicionar" />
                <div className="max-h-40 overflow-y-auto rounded-lg border">
                  {disponiveis.length ? (
                    disponiveis.map((contato) => (
                      <label key={contato.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
                        <Checkbox checked={marcados.has(contato.id)} onCheckedChange={() => alternar(contato.id)} aria-label={contato.nome} />
                        <AvatarNome nome={contato.nome} userId={contato.id} fotoEm={contato.fotoEm} className="size-8" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{contato.nome}</span>
                          <span className="block truncate text-xs text-muted-foreground">@{contato.username}</span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-center text-sm text-muted-foreground">Ninguém encontrado.</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pendente || marcados.size === 0}
                  onClick={() =>
                    void rodar(
                      () => adicionarMembrosGrupoInternoAction(grupo.id, [...marcados]),
                      marcados.size === 1 ? "Pessoa adicionada ao grupo." : "Pessoas adicionadas ao grupo.",
                      async () => {
                        setMarcados(new Set())
                        await onAlterado()
                      },
                    )
                  }
                >
                  <UserPlus className="size-4" />
                  {marcados.size ? `Adicionar (${marcados.size})` : "Adicionar"}
                </Button>
              </>
            ) : (
              <p className="rounded-lg border px-3 py-4 text-center text-sm text-muted-foreground">Todos os usuários com acesso ao chat já estão no grupo.</p>
            )}
          </div>
        ) : null}

        {/* Zona de risco */}
        <div className="flex flex-col gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={pendente}
            onClick={() => {
              if (!window.confirm(`Sair do grupo "${grupo.nome}"?`)) return
              void rodar(() => sairDoGrupoInternoAction(grupo.id), "Você saiu do grupo.", onSaiu)
            }}
          >
            <LogOut className="size-4" />Sair do grupo
          </Button>
          {admin ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pendente}
              onClick={() => {
                if (!window.confirm(`Excluir o grupo "${grupo.nome}" para todos? As mensagens e os arquivos pendentes serão apagados e isso não pode ser desfeito.`)) return
                void rodar(() => excluirGrupoInternoAction(grupo.id), "Grupo excluído.", onExcluido)
              }}
            >
              <Trash2 className="size-4" />Excluir grupo
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
