"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { toast } from "sonner"
import { ArrowLeft, ArrowRightLeft, Bot, Building2, CheckCheck, Clock, Download, FileText, Filter, Hand, Megaphone, MessageCircle, MessagesSquare, MessageSquareReply, Mic, Paperclip, Search, Send, Smile, Sparkles, StickyNote, Trash2, UserCheck, UserRound, X, Zap } from "lucide-react"

import { alternarBotConversaAction, assumirConversaAction } from "@/app/actions/crm"
import { createChatInternalNoteAction, loadChatMessagesAction, refreshChatInboxAction, sendChatAudioAction, sendChatFileAction } from "@/app/actions/chat"
import { sendLeadMessageAction, setLeadStatusAction } from "@/app/actions/leads"
import { saveChatIdentificarAction } from "@/app/actions/users"
import { LinkButton } from "@/components/shared/link-button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ChatExportMenu } from "@/components/features/chat/chat-export-menu"
import { ChatTemplatesDialog } from "@/components/features/chat/chat-templates-dialog"
import { FollowUpChatDialog } from "@/components/features/chat/followup-chat-dialog"
import { EnviarCampanhaDialog } from "@/components/features/crm/enviar-campanha-dialog"
import { TransferirConversaDialog } from "@/components/features/crm/transferir-conversa-dialog"
import { LeadAvatar } from "@/components/shared/lead-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectField } from "@/components/shared/select-field"
import { Textarea } from "@/components/ui/textarea"
import { gatilhoDeTemplate, type ChatTemplate } from "@/lib/chat-templates"
import { avaliarAtendimento } from "@/lib/crm-permissoes"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { InstanceOption } from "@/services/evolution"
import type { ChatInboxSnapshot, ChatMessage } from "@/services/chat"
import type { CrmChatOpcoes } from "@/services/crm"

const INTERVALO_ATUALIZACAO = 8000
const LIMITE_MENSAGEM = 4096
const LIMITE_NOTA_INTERNA = 5000
const CHAVE_VISTAS = "chat-conversas-vistas"
const CHAVE_LARGURA_LISTA = "chat-largura-lista"
const FILTRO_TODOS = "todos"
const FILTRO_MEUS = "meus"
const FILTRO_SEM_RESPONSAVEL = "sem"
const PREFIXO_FILTRO_DEPARTAMENTO = "dep:"
const LARGURA_LISTA_PADRAO = 360
const LARGURA_LISTA_MIN = 260
const LARGURA_CONVERSA_MIN = 360
/** Mensagem de voz: o envio é automático ao chegar nesse tempo (o servidor aceita até 8 MB). */
const DURACAO_MAXIMA_AUDIO_S = 300
/** Imagem/arquivo: o servidor aceita até 16 MB (lib/arquivo-storage.ts). */
const LIMITE_ARQUIVO_BYTES = 16 * 1024 * 1024
const TIPOS_DE_AUDIO = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
const EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😉",
  "😊", "😍", "🥰", "😘", "😎", "🤔", "🙌", "🙏",
  "👏", "👍", "👎", "🤝", "💬", "❤️", "💚", "✨",
  "🎉", "🔥", "✅", "📅", "👋", "💪", "🌷", "☀️",
]

function tamanhoLegivel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function duracaoAudio(segundos: number) {
  const minutos = Math.floor(segundos / 60)
  return `${minutos}:${String(segundos % 60).padStart(2, "0")}`
}

function tipoDeAudioSuportado() {
  if (typeof MediaRecorder === "undefined") return ""
  return TIPOS_DE_AUDIO.find((tipo) => MediaRecorder.isTypeSupported(tipo)) ?? ""
}

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
  const autor = mensagem.lado === "lead" ? "Lead" : mensagem.lado === "interno" ? (mensagem.autor ? `Nota de ${mensagem.autor}` : "Nota interna") : "Você"
  return `${autor}: ${mensagem.texto}`
}

export function ChatInbox({
  inicial,
  instancias,
  nomeUsuario = "",
  identificarRemetenteInicial = false,
  crm = null,
  templatesIniciais = [],
}: {
  inicial: ChatInboxSnapshot
  instancias: InstanceOption[]
  nomeUsuario?: string
  identificarRemetenteInicial?: boolean
  /** Opções do plugin CRM. Nulo = plugin desativado, o chat segue sem transferência. */
  crm?: CrmChatOpcoes | null
  /** Templates de mensagem do usuário ("/nome" no campo de mensagem). */
  templatesIniciais?: ChatTemplate[]
}) {
  const [identificarRemetente, setIdentificarRemetente] = useState(identificarRemetenteInicial)
  const [conversas, setConversas] = useState(inicial.conversas)
  const [conversaSelecionadaId, setConversaSelecionadaId] = useState(inicial.conversaSelecionadaId)
  const [conversaFechada, setConversaFechada] = useState(false)
  const [mensagens, setMensagens] = useState(inicial.mensagens)
  const [busca, setBusca] = useState("")
  const [larguraLista, setLarguraLista] = useState(LARGURA_LISTA_PADRAO)
  const [arrastando, setArrastando] = useState(false)
  const painelRef = useRef<HTMLDivElement>(null)
  const [somenteRespostas, setSomenteRespostas] = useState(false)
  const [filtroAtendimento, setFiltroAtendimento] = useState(FILTRO_TODOS)
  const [transferirAberto, setTransferirAberto] = useState(false)
  const [campanhaAberta, setCampanhaAberta] = useState(false)
  const [followUpAberto, setFollowUpAberto] = useState(false)
  const [modoEscolhido, setModoComposicao] = useState<"mensagem" | "nota" | "resposta">("mensagem")
  const [assumindo, setAssumindo] = useState(false)
  const [alterandoBot, setAlterandoBot] = useState(false)
  const [texto, setTexto] = useState("")
  const [templates, setTemplates] = useState(templatesIniciais)
  const [templatesAberto, setTemplatesAberto] = useState(false)
  const [indiceTemplate, setIndiceTemplate] = useState(0)
  const [menuTemplateFechado, setMenuTemplateFechado] = useState(false)
  const [seletorEmojiAberto, setSeletorEmojiAberto] = useState(false)
  const [instancia, setInstancia] = useState(instancias[0]?.nome ?? "")
  const [enviando, setEnviando] = useState(false)
  // Arquivos recebidos que acabaram de ser baixados (o servidor apaga o arquivo ao terminar o download).
  const [baixados, setBaixados] = useState<Set<string>>(() => new Set())
  const inputArquivoRef = useRef<HTMLInputElement | null>(null)
  const [gravando, setGravando] = useState(false)
  const [segundosGravados, setSegundosGravados] = useState(0)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const pedacosAudioRef = useRef<Blob[]>([])
  const streamAudioRef = useRef<MediaStream | null>(null)
  const timerAudioRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const descartarAudioRef = useRef(false)
  const destinoAudioRef = useRef<{ leadId: string; instancia: string } | null>(null)
  const [vistas, setVistas] = useState<Record<string, string>>({})
  const [vistasCarregadas, setVistasCarregadas] = useState(false)
  const conversaAtiva = conversas.find((conversa) => conversa.id === conversaSelecionadaId) ?? null

  // Plugin CRM: quem pode responder, assumir e transferir esta conversa (notas são sempre livres).
  const permissoes = crm && conversaAtiva ? avaliarAtendimento(conversaAtiva.atendimento, crm.contexto) : null
  const envioBloqueado = permissoes ? !permissoes.podeEnviar : false
  // Estado do bot / agente de IA nesta conversa. Sem registro ainda, o agente vale como ligado,
  // exceto quando a conversa já está com um atendente (o motor o pausa na primeira mensagem).
  const estadoDoBot = conversaAtiva
    ? (conversaAtiva.bot ??
      (conversaAtiva.agenteIa
        ? {
            ativo: !conversaAtiva.atendimento?.atendenteId,
            motivo: conversaAtiva.atendimento?.atendenteId ? "A conversa já está com um atendente." : null,
            aguardando: false,
          }
        : null))
    : null
  const rotuloDoBot = conversaAtiva?.agenteIa ? `O agente de IA “${conversaAtiva.agenteIa.nome}”` : "O bot"
  const modoComposicao = envioBloqueado && modoEscolhido === "mensagem" ? "nota" : modoEscolhido
  const limiteTexto = modoComposicao === "nota" ? LIMITE_NOTA_INTERNA : LIMITE_MENSAGEM

  // Templates: ao digitar "/" (início da mensagem ou depois de espaço) abre o menu filtrado pelo que foi digitado.
  const gatilhoTemplate = modoComposicao === "mensagem" && !gravando ? gatilhoDeTemplate(texto) : null
  const sugestoesTemplate = gatilhoTemplate ? templates.filter((template) => template.nome.startsWith(gatilhoTemplate.consulta)) : []
  const menuTemplateAberto = sugestoesTemplate.length > 0 && !menuTemplateFechado
  const indiceTemplateAtivo = Math.min(indiceTemplate, Math.max(sugestoesTemplate.length - 1, 0))
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
    return correspondeBusca && (!somenteRespostas || conversa.ultimaMensagem?.lado === "lead") && correspondeAtendimento(conversa)
  })
  const totalComResposta = conversas.filter((conversa) => conversa.ultimaMensagem?.lado === "lead").length
  const opcoesFiltroAtendimento = crm
    ? [
        { value: FILTRO_TODOS, label: "Todos os atendimentos" },
        ...(crm.meuAtendenteId ? [{ value: FILTRO_MEUS, label: "Meus chats" }] : []),
        { value: FILTRO_SEM_RESPONSAVEL, label: "Sem responsável" },
        ...crm.departamentos.map((departamento) => ({
          value: `${PREFIXO_FILTRO_DEPARTAMENTO}${departamento.id}`,
          label: `Departamento: ${departamento.nome}`,
        })),
      ]
    : []
  const opcoesInstancia = instancias.map((item) => ({ value: item.nome, label: `${item.nome} · ${item.estado}` }))

  useEffect(() => {
    idSelecionadoRef.current = conversaSelecionadaId
  }, [conversaSelecionadaId])

  /** Filtro do CRM (meus chats, sem responsável, por departamento). Sem o plugin, não filtra nada. */
  function correspondeAtendimento(conversa: ChatInboxSnapshot["conversas"][number]) {
    if (!crm || filtroAtendimento === FILTRO_TODOS) return true
    const atendimento = conversa.atendimento
    if (filtroAtendimento === FILTRO_MEUS) return Boolean(crm.meuAtendenteId) && atendimento?.atendenteId === crm.meuAtendenteId
    if (filtroAtendimento === FILTRO_SEM_RESPONSAVEL) return !atendimento?.departamentoId && !atendimento?.atendenteId
    if (filtroAtendimento.startsWith(PREFIXO_FILTRO_DEPARTAMENTO)) {
      return atendimento?.departamentoId === filtroAtendimento.slice(PREFIXO_FILTRO_DEPARTAMENTO.length)
    }
    return true
  }

  /** Depois de transferir, recarrega a lista para mostrar o novo responsável e a nota interna. */
  async function aoTransferir() {
    const leadId = conversaAtiva?.id
    if (!leadId) return
    try {
      const snapshot = await refreshChatInboxAction(leadId)
      aplicarSnapshot(snapshot, idSelecionadoRef.current === leadId)
    } catch {
      toast.message("Conversa transferida. A lista será atualizada em instantes.")
    }
  }

  useEffect(() => {
    // Recupera até onde cada conversa já foi vista neste navegador.
    try {
      const salvo = window.localStorage.getItem(CHAVE_VISTAS)
      if (salvo) setVistas(JSON.parse(salvo) as Record<string, string>)
    } catch {
      // Sem acesso ao armazenamento: o aviso some apenas até recarregar a página.
    }
    setVistasCarregadas(true)
    try {
      const largura = Number(window.localStorage.getItem(CHAVE_LARGURA_LISTA))
      if (Number.isFinite(largura) && largura > 0) setLarguraLista(limitarLargura(largura))
    } catch {
      // Usa a largura padrão.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mantém a lista dentro dos limites quando a janela é redimensionada.
  useEffect(() => {
    function ajustar() {
      setLarguraLista((atual) => limitarLargura(atual))
    }
    window.addEventListener("resize", ajustar)
    return () => window.removeEventListener("resize", ajustar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (modoComposicao === "mensagem" && envioBloqueado) {
      toast.error(permissoes?.motivo ?? "Você não pode enviar mensagens nesta conversa.")
      return
    }

    setEnviando(true)
    const resultado = modoComposicao === "nota"
      ? await createChatInternalNoteAction(leadId, mensagem)
      : modoComposicao === "resposta"
        ? await setLeadStatusAction(leadId, "respondeu", mensagem)
        : await sendLeadMessageAction(leadId, mensagem, instancia || null, null, identificarRemetente)
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

  async function enviarArquivo(arquivo: File) {
    const leadId = conversaAtiva?.id
    if (!leadId || enviando) return
    if (envioBloqueado) {
      toast.error(permissoes?.motivo ?? "Você não pode enviar mensagens nesta conversa.")
      return
    }
    if (arquivo.size > LIMITE_ARQUIVO_BYTES) {
      toast.error(`O arquivo é muito grande (máximo de ${LIMITE_ARQUIVO_BYTES / 1024 / 1024} MB).`)
      return
    }

    setEnviando(true)
    const dados = new FormData()
    dados.append("arquivo", arquivo)
    dados.append("legenda", texto.trim())
    dados.append("instancia", instancia)
    const resultado = await sendChatFileAction(leadId, dados).catch(() => ({
      ok: false,
      message: "Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.",
    }))
    setEnviando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    setTexto("")
    toast.success(resultado.message)
    pertoDoFimRef.current = true
    try {
      const snapshot = await refreshChatInboxAction(leadId)
      aplicarSnapshot(snapshot, idSelecionadoRef.current === leadId)
    } catch {
      toast.message("Enviado. O histórico será atualizado em instantes.")
    }
  }

  function liberarMicrofone() {
    if (timerAudioRef.current) clearInterval(timerAudioRef.current)
    timerAudioRef.current = null
    streamAudioRef.current?.getTracks().forEach((faixa) => faixa.stop())
    streamAudioRef.current = null
    gravadorRef.current = null
    setGravando(false)
    setSegundosGravados(0)
  }

  /** Para a gravação: com `enviar` o áudio segue para o lead, sem ele é descartado. */
  function pararGravacao(enviar: boolean) {
    descartarAudioRef.current = !enviar
    const gravador = gravadorRef.current
    if (gravador && gravador.state !== "inactive") gravador.stop()
    else liberarMicrofone()
  }

  async function iniciarGravacao() {
    const leadId = conversaAtiva?.id
    if (!leadId || gravando || enviando) return
    if (envioBloqueado) {
      toast.error(permissoes?.motivo ?? "Você não pode enviar mensagens nesta conversa.")
      return
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador não permite gravar áudio. Use um navegador atualizado e acesse o painel por HTTPS.")
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (erro) {
      const negado = erro instanceof DOMException && (erro.name === "NotAllowedError" || erro.name === "SecurityError")
      toast.error(negado ? "Permita o uso do microfone no navegador para gravar a mensagem de voz." : "Não foi possível acessar o microfone.")
      return
    }

    const tipo = tipoDeAudioSuportado()
    const gravador = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined)
    pedacosAudioRef.current = []
    descartarAudioRef.current = false
    destinoAudioRef.current = { leadId, instancia }
    gravador.ondataavailable = (evento) => {
      if (evento.data.size > 0) pedacosAudioRef.current.push(evento.data)
    }
    gravador.onstop = () => void finalizarGravacao(gravador.mimeType || tipo)
    streamAudioRef.current = stream
    gravadorRef.current = gravador
    gravador.start()

    const inicio = Date.now()
    setSegundosGravados(0)
    setGravando(true)
    timerAudioRef.current = setInterval(() => {
      const segundos = Math.floor((Date.now() - inicio) / 1000)
      setSegundosGravados(segundos)
      if (segundos >= DURACAO_MAXIMA_AUDIO_S) pararGravacao(true)
    }, 500)
  }

  async function finalizarGravacao(mime: string) {
    const descartar = descartarAudioRef.current
    const destino = destinoAudioRef.current
    const pedacos = pedacosAudioRef.current
    pedacosAudioRef.current = []
    destinoAudioRef.current = null
    liberarMicrofone()
    if (descartar || !destino || pedacos.length === 0) return

    const audio = new Blob(pedacos, { type: mime || pedacos[0].type })
    if (audio.size < 1000) {
      toast.error("O áudio ficou muito curto. Grave um pouco mais e tente de novo.")
      return
    }

    setEnviando(true)
    const dados = new FormData()
    dados.append("audio", new File([audio], "voz", { type: audio.type }))
    dados.append("instancia", destino.instancia)
    const resultado = await sendChatAudioAction(destino.leadId, dados).catch(() => ({
      ok: false,
      message: "Não foi possível enviar a mensagem de voz. Verifique a conexão e tente de novo.",
    }))
    setEnviando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    toast.success(resultado.message)
    pertoDoFimRef.current = true
    try {
      const snapshot = await refreshChatInboxAction(destino.leadId)
      aplicarSnapshot(snapshot, idSelecionadoRef.current === destino.leadId)
    } catch {
      toast.message("Mensagem de voz enviada. O histórico será atualizado em instantes.")
    }
  }

  // Trocar de conversa (ou sair da tela) descarta uma gravação em andamento e solta o microfone.
  useEffect(() => {
    return () => {
      if (gravadorRef.current) pararGravacao(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaSelecionadaId])

  async function assumirConversaAtual() {
    const leadId = conversaAtiva?.id
    if (!leadId || assumindo) return
    setAssumindo(true)
    const resultado = await assumirConversaAction(leadId)
    setAssumindo(false)
    if (!resultado.ok) {
      toast.error(resultado.message)
      // Pode ter sido assumida por outra pessoa: recarrega para refletir o estado real.
      await aoTransferir()
      return
    }
    toast.success(resultado.message)
    await aoTransferir()
  }

  async function alternarBotAtual(ativo: boolean) {
    const leadId = conversaAtiva?.id
    if (!leadId || alterandoBot) return
    setAlterandoBot(true)
    const resultado = await alternarBotConversaAction(leadId, ativo)
    setAlterandoBot(false)
    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    toast.success(resultado.message)
    await aoTransferir()
  }

  async function alternarIdentificacao() {
    const proximo = !identificarRemetente
    setIdentificarRemetente(proximo)
    const resultado = await saveChatIdentificarAction(proximo)
    if (!resultado.ok) {
      setIdentificarRemetente(!proximo)
      toast.error(resultado.message)
      return
    }
    toast.success(resultado.message)
  }

  /** Troca o "/trecho" digitado pelo texto do template (fica no campo para revisar antes de enviar). */
  function aplicarTemplate(template: ChatTemplate) {
    if (!gatilhoTemplate) return
    setTexto(`${texto.slice(0, gatilhoTemplate.inicio)}${template.texto}`.slice(0, limiteTexto))
    setIndiceTemplate(0)
    setMenuTemplateFechado(false)
  }

  function tratarTecla(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuTemplateAberto) {
      const total = sugestoesTemplate.length
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setIndiceTemplate((indiceTemplateAtivo + 1) % total)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setIndiceTemplate((indiceTemplateAtivo - 1 + total) % total)
        return
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault()
        aplicarTemplate(sugestoesTemplate[indiceTemplateAtivo])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuTemplateFechado(true)
        return
      }
    }
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

  function limitarLargura(valor: number) {
    const total = painelRef.current?.clientWidth ?? 1200
    const maximo = Math.max(LARGURA_LISTA_MIN, total - LARGURA_CONVERSA_MIN)
    return Math.min(Math.max(valor, LARGURA_LISTA_MIN), maximo)
  }

  function salvarLargura(valor: number) {
    try {
      window.localStorage.setItem(CHAVE_LARGURA_LISTA, String(Math.round(valor)))
    } catch {
      // Sem armazenamento: a largura vale só até recarregar.
    }
  }

  function iniciarRedimensionamento(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setArrastando(true)
  }

  function redimensionar(event: ReactPointerEvent<HTMLDivElement>) {
    if (!arrastando || !painelRef.current) return
    const esquerda = painelRef.current.getBoundingClientRect().left
    setLarguraLista(limitarLargura(event.clientX - esquerda))
  }

  function finalizarRedimensionamento(event: ReactPointerEvent<HTMLDivElement>) {
    if (!arrastando) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setArrastando(false)
    salvarLargura(larguraLista)
  }

  function redimensionarPorTeclado(event: KeyboardEvent<HTMLDivElement>) {
    const passo = event.shiftKey ? 48 : 16
    let nova: number | null = null
    if (event.key === "ArrowLeft") nova = larguraLista - passo
    else if (event.key === "ArrowRight") nova = larguraLista + passo
    else if (event.key === "Home") nova = LARGURA_LISTA_MIN
    else if (event.key === "End") nova = Number.MAX_SAFE_INTEGER
    if (nova === null) return
    event.preventDefault()
    const limitada = limitarLargura(nova)
    setLarguraLista(limitada)
    salvarLargura(limitada)
  }

  function restaurarLargura() {
    const padrao = limitarLargura(LARGURA_LISTA_PADRAO)
    setLarguraLista(padrao)
    salvarLargura(padrao)
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

      <div
        ref={painelRef}
        style={{ "--largura-lista": `${larguraLista}px` } as CSSProperties}
        className={cn(
          "relative grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[var(--largura-lista)_minmax(0,1fr)]",
          arrastando && "select-none lg:cursor-col-resize",
        )}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar a lista de conversas"
          aria-valuenow={Math.round(larguraLista)}
          aria-valuemin={LARGURA_LISTA_MIN}
          tabIndex={0}
          title="Arraste para ajustar a largura · duplo clique para restaurar"
          onPointerDown={iniciarRedimensionamento}
          onPointerMove={redimensionar}
          onPointerUp={finalizarRedimensionamento}
          onPointerCancel={finalizarRedimensionamento}
          onKeyDown={redimensionarPorTeclado}
          onDoubleClick={restaurarLargura}
          style={{ left: "calc(var(--largura-lista) - 4px)" }}
          className="group absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none lg:block"
        >
          <span
            className={cn(
              "mx-auto block h-full w-0.5 transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary",
              arrastando && "bg-primary",
            )}
          />
        </div>
        <aside className={cn("min-h-0 flex-col bg-card lg:flex lg:border-r", conversaAtiva ? "hidden" : "flex")}>
          <div className="flex min-h-18 items-center justify-between gap-2 border-b bg-card px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Leads e conversas</h2>
              <p className="text-xs text-muted-foreground">{conversas.length} leads cadastrados</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ChatExportMenu conversaAtualId={conversaAtiva?.id ?? null} idsListados={conversasVisiveis.map((conversa) => conversa.id)} />
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
          {crm ? (
            <div className="px-3 pb-2">
              <SelectField
                value={filtroAtendimento}
                onValueChange={setFiltroAtendimento}
                opcoes={opcoesFiltroAtendimento}
                size="sm"
                className="w-full rounded-lg bg-muted"
              />
            </div>
          ) : null}
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
                  <LeadAvatar
                    leadId={conversa.id}
                    nome={conversa.nome}
                    telefone={conversa.telefone}
                    className="size-10 shrink-0"
                    fallbackClassName={cn("text-sm font-semibold", respondeu ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}
                  />
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
                    {crm && (conversa.atendimento?.departamentoNome || conversa.atendimento?.atendenteNome) ? (
                      <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                        {conversa.atendimento?.departamentoNome ? (
                          <span className="flex min-w-0 items-center gap-1">
                            <Building2 className="size-3 shrink-0" />
                            <span className="truncate">{conversa.atendimento.departamentoNome}</span>
                          </span>
                        ) : null}
                        {conversa.atendimento?.atendenteNome ? (
                          <span className="flex min-w-0 items-center gap-1">
                            <UserRound className="size-3 shrink-0" />
                            <span className="truncate">{conversa.atendimento.atendenteNome}</span>
                          </span>
                        ) : null}
                      </span>
                    ) : null}
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
                  <Popover>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Ver perfil de ${conversaAtiva.nome}`}
                          title="Ver perfil"
                          className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left transition-colors hover:bg-muted/60 sm:gap-3"
                        >
                          <LeadAvatar leadId={conversaAtiva.id} nome={conversaAtiva.nome} telefone={conversaAtiva.telefone} className="size-10 shrink-0" fallbackClassName="bg-primary/15 text-sm font-semibold text-primary" />
                          <span className="min-w-0">
                            <span className="block truncate text-[15px] font-semibold leading-tight">{conversaAtiva.nome}</span>
                            <span className="block truncate text-xs text-muted-foreground">{conversaAtiva.telefone}</span>
                          </span>
                        </button>
                      }
                    />
                    <PopoverContent align="start" className="w-80 gap-4">
                      <div className="flex items-center gap-3">
                        <LeadAvatar leadId={conversaAtiva.id} nome={conversaAtiva.nome} telefone={conversaAtiva.telefone} className="size-14 shrink-0" fallbackClassName="bg-primary/15 text-base font-semibold text-primary" />
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold">{conversaAtiva.nome}</h3>
                          <p className="truncate text-sm text-muted-foreground">{conversaAtiva.telefone}</p>
                          <Badge variant="secondary" className="mt-1.5 capitalize">{conversaAtiva.status.replaceAll("_", " ")}</Badge>
                        </div>
                      </div>
                      {conversaAtiva.campanhasNomes.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Megaphone className="size-4 shrink-0 text-primary" />
                          {conversaAtiva.campanhasNomes.map((nome) => (
                            <Badge key={nome} className="max-w-full"><span className="truncate">{nome}</span></Badge>
                          ))}
                        </div>
                      ) : null}
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3">
                        <CampoPerfil rotulo="Produto" valor={conversaAtiva.produto} />
                        <CampoPerfil rotulo="Marca" valor={conversaAtiva.marca} />
                        <CampoPerfil rotulo="Persona" valor={conversaAtiva.persona} />
                        <CampoPerfil rotulo="Região" valor={conversaAtiva.regiao} />
                        <CampoPerfil rotulo="Negócio" valor={conversaAtiva.negocio} />
                        <CampoPerfil rotulo="Atividade" valor={conversaAtiva.atividade} />
                      </dl>
                      <LinkButton variant="outline" size="sm" className="w-fit" href={`/leads/${conversaAtiva.id}`}>
                        Ver cadastro completo
                      </LinkButton>
                    </PopoverContent>
                  </Popover>
                  {conversaAtiva.campanhasNomes.length > 0 ? (
                    <div className="hidden min-w-0 items-center gap-1.5 sm:flex" title={`Campanha vinculada: ${conversaAtiva.campanhasNomes.join(", ")}`}>
                      <Megaphone className="size-4 shrink-0 text-primary" aria-label="Campanha vinculada" />
                      {conversaAtiva.campanhasNomes.slice(0, 2).map((nome) => (
                        <Badge key={nome} className="max-w-40"><span className="truncate">{nome}</span></Badge>
                      ))}
                      {conversaAtiva.campanhasNomes.length > 2 ? (
                        <Badge variant="secondary">+{conversaAtiva.campanhasNomes.length - 2}</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {crm ? (
                    <>
                      {conversaAtiva.atendimento?.departamentoNome || conversaAtiva.atendimento?.atendenteNome ? (
                        <div
                          className="hidden min-w-0 items-center gap-1.5 md:flex"
                          title={`Responsável: ${[conversaAtiva.atendimento?.departamentoNome, conversaAtiva.atendimento?.atendenteNome].filter(Boolean).join(" / ")}`}
                        >
                          {conversaAtiva.atendimento?.departamentoNome ? (
                            <Badge variant="outline" className="max-w-32 gap-1">
                              <Building2 />
                              <span className="truncate">{conversaAtiva.atendimento.departamentoNome}</span>
                            </Badge>
                          ) : null}
                          {conversaAtiva.atendimento?.atendenteNome ? (
                            <Badge variant="outline" className="max-w-32 gap-1">
                              <UserRound />
                              <span className="truncate">{conversaAtiva.atendimento.atendenteNome}</span>
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                      {estadoDoBot && permissoes?.podeEnviar ? (
                        <Button
                          variant={estadoDoBot.ativo ? "ghost" : "outline"}
                          size="sm"
                          className="rounded-full"
                          disabled={alterandoBot}
                          title={
                            estadoDoBot.ativo
                              ? `${rotuloDoBot} responde esta conversa. Clique para pausar.`
                              : `${estadoDoBot.motivo ?? `${rotuloDoBot} pausado nesta conversa.`} Clique para reativar.`
                          }
                          onClick={() => void alternarBotAtual(!estadoDoBot.ativo)}
                        >
                          {conversaAtiva.agenteIa ? <Sparkles className="size-4" /> : <Bot className="size-4" />}
                          <span className="hidden sm:inline">
                            {estadoDoBot.ativo ? "Pausar" : "Reativar"} {conversaAtiva.agenteIa ? "agente de IA" : "bot"}
                          </span>
                        </Button>
                      ) : null}
                      {conversaAtiva.followUp && permissoes?.podeEnviar ? (
                        <Button
                          variant={conversaAtiva.followUp.botAtivo && !conversaAtiva.followUp.desativado ? "ghost" : "outline"}
                          size="sm"
                          className="rounded-full"
                          title={
                            !conversaAtiva.followUp.botAtivo
                              ? "O bot de follow-up deste departamento está desligado."
                              : conversaAtiva.followUp.desativado
                                ? "Follow-up automático desligado neste chat."
                                : conversaAtiva.followUp.templateManual
                                  ? "Follow-up automático ligado, com template escolhido para este chat."
                                  : "Follow-up automático ligado neste chat."
                          }
                          onClick={() => setFollowUpAberto(true)}
                        >
                          <Clock className="size-4" />
                          <span className="hidden sm:inline">
                            {conversaAtiva.followUp.botAtivo && !conversaAtiva.followUp.desativado ? "Follow-up" : "Follow-up off"}
                          </span>
                        </Button>
                      ) : null}
                      {permissoes?.podeAssumir ? (
                        <Button size="sm" className="rounded-full" disabled={assumindo} onClick={() => void assumirConversaAtual()}>
                          <Hand className="size-4" />
                          <span className="hidden sm:inline">{assumindo ? "Assumindo..." : "Assumir conversa"}</span>
                        </Button>
                      ) : null}
                      {permissoes?.podeEnviar ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          aria-label="Enviar para campanha"
                          title="Enviar para campanha"
                          onClick={() => setCampanhaAberta(true)}
                        >
                          <Megaphone className="size-4" />
                        </Button>
                      ) : null}
                      {permissoes?.podeTransferir ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          aria-label="Transferir conversa"
                          title="Transferir conversa"
                          onClick={() => setTransferirAberto(true)}
                        >
                          <ArrowRightLeft className="size-4" />
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <ChatExportMenu conversaAtualId={conversaAtiva.id} idsListados={conversasVisiveis.map((conversa) => conversa.id)} />
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="Sair da conversa" title="Sair da conversa" onClick={sairDaConversa}>
                    <X className="size-4" />
                  </Button>
                </div>
              </header>

              <div className="flex min-h-0 flex-1 flex-col">
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
                                <span className="mb-0.5 flex items-center gap-1 text-xs font-semibold"><StickyNote className="size-3" />{mensagem.autor ? `Nota interna · ${mensagem.autor}` : "Nota interna"}</span>
                              ) : null}
                              {mensagem.campanhaNome ? (
                                <span className="mb-0.5 block max-w-56 truncate text-xs font-semibold text-primary">{mensagem.campanhaNome}</span>
                              ) : null}
                              {mensagem.audio ? (
                                mensagem.audio.disponivel ? (
                                  <audio controls preload="none" src={`/api/chat/audio/${mensagem.audio.id}`} className="h-10 w-64 max-w-full" aria-label="Mensagem de voz" />
                                ) : (
                                  <span className="flex items-center gap-1.5 text-sm italic text-muted-foreground"><Mic className="size-4 shrink-0" />Áudio expirado e removido do servidor</span>
                                )
                              ) : mensagem.arquivo ? (
                                <span className="flex flex-col gap-1.5">
                                  <span className="flex items-center gap-2.5">
                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/10"><FileText className="size-5" /></span>
                                    <span className="min-w-0">
                                      <span className="block max-w-56 truncate text-sm font-medium">{mensagem.arquivo.nome}</span>
                                      <span className="block text-xs text-muted-foreground">{tamanhoLegivel(mensagem.arquivo.tamanho)}</span>
                                    </span>
                                  </span>
                                  {mensagem.arquivo.disponivel && !baixados.has(mensagem.arquivo.id) ? (
                                    <a
                                      href={`/api/chat/arquivo/${mensagem.arquivo.id}`}
                                      download={mensagem.arquivo.nome}
                                      className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                                      onClick={() => {
                                        const arquivoId = mensagem.arquivo!.id
                                        setTimeout(() => setBaixados((atual) => new Set(atual).add(arquivoId)), 1500)
                                      }}
                                    >
                                      <Download className="size-3.5" />Baixar
                                    </a>
                                  ) : (
                                    <span className="text-xs italic text-muted-foreground">Baixado e removido do servidor</span>
                                  )}
                                  {mensagem.arquivo.legenda ? <span className="whitespace-pre-wrap wrap-break-word">{mensagem.arquivo.legenda}</span> : null}
                                </span>
                              ) : (
                                <span className="whitespace-pre-wrap wrap-break-word">{mensagem.texto || "(mensagem sem texto)"}</span>
                              )}
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
                    {envioBloqueado ? (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-100/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        <span className="min-w-0 flex-1">{permissoes?.motivo}</span>
                      </div>
                    ) : permissoes?.podeAssumir && !conversaAtiva.atendimento?.atendenteId ? (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1">Esta conversa está no departamento sem atendente responsável.</span>
                        <Button size="sm" className="rounded-full" disabled={assumindo} onClick={() => void assumirConversaAtual()}>
                          <Hand className="size-4" />
                          {assumindo ? "Assumindo..." : "Assumir conversa"}
                        </Button>
                      </div>
                    ) : null}
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
                      {modoComposicao === "mensagem" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          aria-label="Templates de mensagem"
                          title="Templates de mensagem (no campo, digite /nome)"
                          disabled={enviando}
                          onClick={() => setTemplatesAberto(true)}
                        >
                          <Zap className="size-4" />
                        </Button>
                      ) : null}
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
                      {modoComposicao === "mensagem" ? (
                        <Button
                          type="button"
                          variant={identificarRemetente ? "secondary" : "ghost"}
                          size="icon"
                          className="rounded-full"
                          aria-label="Enviar meu nome junto com a mensagem"
                          aria-pressed={identificarRemetente}
                          title={
                            identificarRemetente
                              ? `Identificação ativa: o lead recebe "${nomeUsuario}" junto com a mensagem`
                              : "Identificar remetente: enviar meu nome junto com a mensagem"
                          }
                          disabled={enviando}
                          onClick={() => void alternarIdentificacao()}
                        >
                          <UserCheck className="size-4" />
                        </Button>
                      ) : null}
                      {modoComposicao !== "mensagem" ? (
                        <>
                          {envioBloqueado && modoComposicao === "nota" ? null : (
                            <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Cancelar registro" title="Cancelar registro" disabled={enviando} onClick={() => trocarModoComposicao("mensagem")}>
                              <X className="size-4" />
                            </Button>
                          )}
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
                    <div className="relative flex items-end gap-2">
                      {menuTemplateAberto ? (
                        <div
                          role="listbox"
                          aria-label="Templates de mensagem"
                          className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
                        >
                          {sugestoesTemplate.map((template, indice) => (
                            <button
                              key={template.id}
                              type="button"
                              role="option"
                              aria-selected={indice === indiceTemplateAtivo}
                              onMouseDown={(event) => {
                                event.preventDefault()
                                aplicarTemplate(template)
                              }}
                              onMouseEnter={() => setIndiceTemplate(indice)}
                              className={cn(
                                "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left",
                                indice === indiceTemplateAtivo && "bg-accent text-accent-foreground",
                              )}
                            >
                              <span className="font-mono text-sm font-medium">/{template.nome}</span>
                              <span className="line-clamp-1 w-full text-xs text-muted-foreground">{template.texto}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {gravando ? (
                        <div className="flex min-h-14 flex-1 items-center gap-3 rounded-2xl border border-input bg-muted/50 px-5 dark:bg-muted/40" role="status" aria-live="polite">
                          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                          <span className="text-base font-medium tabular-nums">{duracaoAudio(segundosGravados)}</span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">Gravando mensagem de voz...</span>
                          <Button type="button" variant="ghost" size="icon" className="ml-auto shrink-0 rounded-full" aria-label="Descartar gravação" title="Descartar gravação" onClick={() => pararGravacao(false)}>
                            <Trash2 className="size-5" />
                          </Button>
                        </div>
                      ) : (
                        <>
                        {modoComposicao === "mensagem" ? (
                          <>
                            <input
                              ref={inputArquivoRef}
                              type="file"
                              className="hidden"
                              onChange={(event) => {
                                const arquivo = event.target.files?.[0]
                                event.target.value = ""
                                if (arquivo) void enviarArquivo(arquivo)
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-14 shrink-0 rounded-full"
                              onClick={() => inputArquivoRef.current?.click()}
                              disabled={enviando || instancias.length === 0}
                              aria-label="Enviar imagem ou arquivo"
                              title="Enviar imagem ou arquivo (o texto digitado vai como legenda)"
                            >
                              <Paperclip className="size-6" />
                            </Button>
                          </>
                        ) : null}
                        <Textarea
                          value={texto}
                          onChange={(event) => {
                            setTexto(event.target.value)
                            setIndiceTemplate(0)
                            setMenuTemplateFechado(false)
                          }}
                          onKeyDown={tratarTecla}
                          maxLength={limiteTexto}
                          placeholder={modoComposicao === "nota" ? "Escreva uma nota interna..." : modoComposicao === "resposta" ? "Registre o que o lead respondeu..." : `Escreva uma mensagem para ${conversaAtiva.nome}...`}
                          className="max-h-48 min-h-14 resize-none rounded-2xl border-input bg-muted/50 px-5 py-4 text-base leading-snug md:text-base dark:bg-muted/40"
                          aria-label={modoComposicao === "nota" ? "Nota interna" : modoComposicao === "resposta" ? "Resposta do lead" : "Mensagem para o lead"}
                          disabled={enviando}
                        />
                        </>
                      )}
                      {gravando ? (
                        <Button size="icon" className="size-14 shrink-0 rounded-full" onClick={() => pararGravacao(true)} aria-label="Enviar mensagem de voz" title="Enviar mensagem de voz">
                          <Send className="size-6" />
                        </Button>
                      ) : modoComposicao === "mensagem" && !texto.trim() ? (
                        <Button
                          size="icon"
                          className="size-14 shrink-0 rounded-full"
                          onClick={() => void iniciarGravacao()}
                          disabled={enviando || instancias.length === 0}
                          aria-label="Gravar mensagem de voz"
                          title="Gravar mensagem de voz"
                        >
                          <Mic className="size-6" />
                        </Button>
                      ) : (
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
                      )}
                    </div>
                    <div className="mt-2 flex justify-between gap-3 px-2 text-[11px] text-muted-foreground">
                      <span>{modoComposicao === "mensagem" && identificarRemetente && nomeUsuario ? `Enviando como ${nomeUsuario} · ` : ""}{gravando ? "Toque em enviar para mandar o áudio ou na lixeira para descartar" : <>Enter para {modoComposicao === "nota" ? "salvar nota" : modoComposicao === "resposta" ? "registrar resposta" : "enviar"} · Shift+Enter para nova linha{modoComposicao === "mensagem" ? " · / para templates" : ""}</>}</span>
                      {gravando ? null : <span className="shrink-0 tabular-nums">{texto.length}/{limiteTexto}</span>}
                    </div>
                  </div>
              </div>
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

      {crm && conversaAtiva?.followUp ? (
        <FollowUpChatDialog
          open={followUpAberto}
          onOpenChange={setFollowUpAberto}
          leadId={conversaAtiva.id}
          leadNome={conversaAtiva.nome}
          aoAlterar={() => void aoTransferir()}
        />
      ) : null}

      {crm && conversaAtiva ? (
        <EnviarCampanhaDialog
          open={campanhaAberta}
          onOpenChange={setCampanhaAberta}
          leadId={conversaAtiva.id}
          leadNome={conversaAtiva.nome}
          campanhas={crm.campanhas}
          campanhasDoLead={conversaAtiva.campanhasNomes}
          onEnviado={() => void aoTransferir()}
        />
      ) : null}

      {crm && conversaAtiva ? (
        <TransferirConversaDialog
          open={transferirAberto}
          onOpenChange={setTransferirAberto}
          leadId={conversaAtiva.id}
          leadNome={conversaAtiva.nome}
          atual={conversaAtiva.atendimento}
          opcoes={crm}
          onTransferido={() => void aoTransferir()}
        />
      ) : null}

      <ChatTemplatesDialog
        open={templatesAberto}
        onOpenChange={setTemplatesAberto}
        templates={templates}
        onTemplatesChange={setTemplates}
      />
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
