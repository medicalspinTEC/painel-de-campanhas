"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { ArrowLeft, CheckCheck, Download, FileText, ImageIcon, LogOut, MessageCircle, Paperclip, Plus, Search, Send, Users, X } from "lucide-react"

import {
  abrirConversaInternaAction,
  criarGrupoInternoAction,
  enviarMensagemInternaAction,
  loadChatInternoMensagensAction,
  refreshChatInternoAction,
  sairDoGrupoInternoAction,
} from "@/app/actions/chat-interno"
import { ChatAbas } from "@/components/features/chat/chat-abas"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { InternoContato, InternoConversaDto, InternoMensagemDto, InternoSnapshot } from "@/services/chat-interno"

const INTERVALO_ATUALIZACAO = 4000
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

function AvatarNome({ nome, grupo = false, className }: { nome: string; grupo?: boolean; className?: string }) {
  return (
    <Avatar className={cn("size-10 shrink-0", className)}>
      <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
        {grupo ? <Users className="size-4" /> : iniciais(nome)}
      </AvatarFallback>
    </Avatar>
  )
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
  const [busca, setBusca] = useState("")
  const [texto, setTexto] = useState("")
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [novaAberta, setNovaAberta] = useState(false)
  // Anexos que acabaram de ser baixados por mim (o servidor registra o fim do download).
  const [baixados, setBaixados] = useState<Set<string>>(new Set())

  const selecionadaRef = useRef(selecionadaId)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const pertoDoFimRef = useRef(true)
  const ultimoIdRef = useRef<string | null>(null)
  const conversaDoScrollRef = useRef<string | null>(null)
  const inputArquivoRef = useRef<HTMLInputElement | null>(null)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)

  const conversaAtiva = conversas.find((c) => c.id === selecionadaId) ?? null
  const totalNaoLidas = conversas.reduce((soma, c) => soma + c.naoLidas, 0)

  const conversasVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return conversas
    return conversas.filter((c) => c.nome.toLowerCase().includes(termo))
  }, [busca, conversas])

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
          const snapshot = await refreshChatInternoAction(alvo)
          // Se o usuário trocou de conversa durante a consulta, descarta o histórico antigo.
          if (ativo) aplicar(snapshot, selecionadaRef.current === alvo && Boolean(alvo))
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
  }, [aplicar])

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
    setMensagens([])
    setTexto("")
    setArquivo(null)
    // Abrir a conversa zera o contador dela na hora.
    setConversas((atual) => atual.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)))
    const resultado = await loadChatInternoMensagensAction(id)
    if (selecionadaRef.current !== id) return
    if (resultado.ok) setMensagens(resultado.mensagens)
    else toast.error(resultado.message)
  }

  function voltarParaLista() {
    selecionadaRef.current = null
    setSelecionadaId(null)
    setMensagens([])
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
                  <AvatarNome nome={conversa.nome} grupo={conversa.tipo === "grupo"} />
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
              <AvatarNome nome={conversaAtiva.nome} grupo={conversaAtiva.tipo === "grupo"} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[15px] font-semibold leading-tight">{conversaAtiva.nome}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {conversaAtiva.tipo === "grupo"
                    ? conversaAtiva.participantes.map((p) => (p.id === usuarioId ? "Você" : p.nome)).join(", ")
                    : `@${conversaAtiva.participantes.find((p) => p.id !== usuarioId)?.username ?? ""}`}
                </p>
              </div>
              {conversaAtiva.tipo === "grupo" ? (
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="Sair do grupo" title="Sair do grupo" onClick={() => void sairDoGrupo()}>
                  <LogOut className="size-4" />
                </Button>
              ) : null}
            </header>

            <div ref={areaRef} onScroll={aoRolar} className="wa-wallpaper flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 lg:px-12">
              {mensagens.length ? (
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
                  <AvatarNome nome={contato.nome} className="size-8" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{contato.nome}</span><span className="block truncate text-xs text-muted-foreground">@{contato.username}</span></span>
                </label>
              ) : (
                <button key={contato.id} type="button" disabled={pendente} onClick={() => void abrirDireta(contato.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 disabled:opacity-60">
                  <AvatarNome nome={contato.nome} className="size-8" />
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
