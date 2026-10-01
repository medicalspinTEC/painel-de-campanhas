"use client"

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import { CircleHelp, Clock3, Copy, ListChecks, MessageSquareText, Send, X } from "lucide-react"
import { toast } from "sonner"

import { consultarAssistenteAction } from "@/app/actions/assistant"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format"
import type {
  AssistenteConsulta,
  AssistenteConsultaResultado,
  AssistenteDashboard,
  AssistenteLead,
  AssistenteRelatorios,
} from "@/services/assistant"
import type { Kpis } from "@/types"

type ConsultaAtual =
  | { tipo: "kpis"; kpis: Kpis }
  | { tipo: "relatorios"; relatorios: AssistenteRelatorios }
  | { tipo: "dashboard"; dashboard: AssistenteDashboard }
  | (AssistenteConsultaResultado & { tipo: Exclude<AssistenteConsulta, "kpis" | "relatorios" | "dashboard"> })

type MensagemChat = {
  id: string
  papel: "usuario" | "assistente"
  texto: string
  consulta?: ConsultaAtual
  pendente?: boolean
}

const CHAT_STORAGE_KEY = "medical-spin-assistant-chat-v1"
const CHAT_TTL_MS = 10 * 60 * 1000
const MENSAGEM_BOAS_VINDAS: MensagemChat = {
  id: "boas-vindas",
  papel: "assistente",
  texto: "Olá! Sou um assistente determinístico, sem IA. Pergunte sobre leads, KPIs ou relatórios. Use o ícone de ajuda para ver as consultas disponíveis.",
}

const EXEMPLOS_CONSULTA = [
  "Mostre todos os KPIs",
  "Quais são os KPIs dos relatórios?",
  "Mostre os relatórios do dashboard",
  "Quais leads não responderam à última mensagem há 24 horas?",
  "Quais leads nunca responderam?",
  "Quais leads estão sem campanha ativa?",
  "Quais leads responderam nos últimos 7 dias?",
  "Sugira mensagem para leads sem resposta há 48 horas",
]

function interpretarConsulta(mensagem: string): AssistenteConsulta | null {
  const texto = mensagem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

  if (texto.includes("relatorio")) return texto.includes("dashboard") ? "dashboard" : "relatorios"
  if (texto.includes("dashboard") || texto.includes("painel")) return "dashboard"
  if (texto.includes("kpi") || texto.includes("indicador")) return "kpis"
  if ((texto.includes("nunca") || texto.includes("jamais")) && /respost|respond/.test(texto)) {
    return "nuncaResponderam"
  }
  if (/sem campanha|nenhuma campanha|fora de campanha|campanha ativa/.test(texto)) {
    return "semCampanhaAtiva"
  }
  if (/respost|respond/.test(texto) && /7|sete|semana|recent/.test(texto)) {
    return "respostasRecentes"
  }
  if (/48|quarenta e oito|dois dias|2 dias/.test(texto) && /respost|respond|mensagem|suger/.test(texto)) {
    return "semResposta48h"
  }
  if (/24|vinte e quatro|um dia|1 dia/.test(texto) && /respost|respond|mensagem/.test(texto)) {
    return "semResposta24h"
  }
  if (/sem resposta|nao responderam|nao respondeu|ultima mensagem/.test(texto)) {
    return "semResposta24h"
  }
  return null
}

function textoDaResposta(tipo: AssistenteConsulta) {
  switch (tipo) {
    case "kpis":
      return "Estes são os indicadores atuais do Dashboard."
    case "relatorios":
      return "Aqui estão os KPIs e métricas da aba Relatórios, considerando o histórico completo."
    case "dashboard":
      return "Aqui estão os dados dos painéis do Dashboard."
    case "semResposta24h":
      return "Leads cuja última mensagem enviada continua sem resposta há mais de 24 horas:"
    case "semResposta48h":
      return "Leads cuja última mensagem enviada continua sem resposta há mais de 48 horas. Você pode pedir uma sugestão individual de mensagem:"
    case "nuncaResponderam":
      return "Leads sem nenhum evento de resposta registrado:"
    case "semCampanhaAtiva":
      return "Leads que não estão vinculados a uma campanha ativa:"
    case "respostasRecentes":
      return "Leads que responderam nos últimos 7 dias:"
  }
}

function lerHistoricoChat(): MensagemChat[] | null {
  try {
    const salvo = sessionStorage.getItem(CHAT_STORAGE_KEY)
    if (!salvo) return null

    const dados = JSON.parse(salvo) as { atividadeEm?: unknown; mensagens?: unknown }
    if (
      typeof dados.atividadeEm !== "number" ||
      Date.now() - dados.atividadeEm > CHAT_TTL_MS ||
      dados.atividadeEm > Date.now() ||
      !Array.isArray(dados.mensagens)
    ) {
      sessionStorage.removeItem(CHAT_STORAGE_KEY)
      return null
    }

    const mensagens = dados.mensagens.filter(
      (mensagem): mensagem is MensagemChat =>
        typeof mensagem === "object" &&
        mensagem !== null &&
        "id" in mensagem &&
        typeof mensagem.id === "string" &&
        "papel" in mensagem &&
        (mensagem.papel === "usuario" || mensagem.papel === "assistente") &&
        "texto" in mensagem &&
        typeof mensagem.texto === "string",
    )
    if (mensagens.length === 0) return null

    return mensagens.map((mensagem) =>
      mensagem.pendente
        ? {
            ...mensagem,
            pendente: false,
            texto: "A consulta foi interrompida ao recarregar. Envie novamente para obter um resultado atualizado.",
          }
        : mensagem,
    )
  } catch {
    try {
      sessionStorage.removeItem(CHAT_STORAGE_KEY)
    } catch {
      return null
    }
    return null
  }
}

function gerarSugestao(lead: AssistenteLead) {
  const primeiroNome = lead.nome.trim().split(/\s+/)[0] || "tudo bem"
  return `Olá, ${primeiroNome}! Tudo bem? Estou retomando a mensagem que enviei. Você conseguiu ver? Se ficou alguma dúvida, estou à disposição para ajudar.`
}

export function AssistantChat({
  compact = false,
  onClose,
}: {
  compact?: boolean
  onClose?: () => void
} = {}) {
  const [mensagens, setMensagens] = useState<MensagemChat[]>([MENSAGEM_BOAS_VINDAS])
  const [texto, setTexto] = useState("")
  const [ajudaAberta, setAjudaAberta] = useState(false)
  const [leadSugestao, setLeadSugestao] = useState<AssistenteLead | null>(null)
  const [pending, startTransition] = useTransition()
  const [historicoCarregado, setHistoricoCarregado] = useState(false)
  const historicoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const salvo = lerHistoricoChat()
    if (salvo) setMensagens(salvo)
    setHistoricoCarregado(true)
  }, [])

  useEffect(() => {
    if (!historicoCarregado) return

    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ atividadeEm: Date.now(), mensagens }))
    } catch {
      // O chat segue funcionando em memória quando o navegador bloqueia armazenamento da sessão.
    }

    const temporizador = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(CHAT_STORAGE_KEY)
      } catch {
        // O histórico da tela também é limpo se o armazenamento não estiver disponível.
      }
      setMensagens([MENSAGEM_BOAS_VINDAS])
    }, CHAT_TTL_MS)

    return () => window.clearTimeout(temporizador)
  }, [historicoCarregado, mensagens])

  useEffect(() => {
    const historico = historicoRef.current
    if (historico) historico.scrollTop = historico.scrollHeight
  }, [mensagens])

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const pergunta = texto.trim()
    if (!pergunta || pending) return

    const id = crypto.randomUUID()
    const consulta = interpretarConsulta(pergunta)
    setTexto("")
    setMensagens((atuais) => [
      ...atuais,
      { id: `usuario-${id}`, papel: "usuario", texto: pergunta },
      {
        id: `assistente-${id}`,
        papel: "assistente",
        texto: consulta ? "Consultando..." : "Não reconheci essa consulta. Abra a ajuda para ver as funções disponíveis.",
        pendente: Boolean(consulta),
      },
    ])

    if (!consulta) return

    startTransition(async () => {
      const resultado = await consultarAssistenteAction(consulta)
      let resposta: MensagemChat
      if (!resultado.ok) {
        resposta = { id: `assistente-${id}`, papel: "assistente", texto: resultado.message }
      } else {
        let dados: ConsultaAtual
        if ("kpis" in resultado) {
          dados = { tipo: "kpis", kpis: resultado.kpis }
        } else if ("relatorios" in resultado) {
          dados = { tipo: "relatorios", relatorios: resultado.relatorios }
        } else if ("dashboard" in resultado) {
          dados = { tipo: "dashboard", dashboard: resultado.dashboard }
        } else {
          dados = { tipo: resultado.tipo, leads: resultado.leads, total: resultado.total, limite: resultado.limite }
        }
        resposta = {
          id: `assistente-${id}`,
          papel: "assistente",
          texto: textoDaResposta(consulta),
          consulta: dados,
        }
      }
      setMensagens((atuais) => atuais.map((mensagem) => (mensagem.id === resposta.id ? resposta : mensagem)))
    })
  }

  async function copiarSugestao() {
    if (!leadSugestao) return
    try {
      await navigator.clipboard.writeText(gerarSugestao(leadSugestao))
      toast.success("Sugestão copiada.")
    } catch {
      toast.error("Não foi possível copiar a sugestão.")
    }
  }

  return (
    <>
      <Card className={compact ? "h-full min-h-0 gap-0 overflow-hidden py-0" : undefined}>
        <CardHeader className={compact ? "flex-row items-center justify-between gap-3 px-3 py-3" : "flex-row items-start justify-between gap-4"}>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ListChecks className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="text-base">Assistente</CardTitle>
              {!compact ? (
                <CardDescription>
                  Chat determinístico, sem IA. O histórico fica salvo nesta aba por até 10 minutos de inatividade.
                </CardDescription>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ajuda sobre as funções do Assistente"
              title="Ajuda sobre as funções do Assistente"
              onClick={() => setAjudaAberta(true)}
            >
              <CircleHelp className="size-4" />
            </Button>
            {onClose ? (
              <Button variant="ghost" size="icon" aria-label="Fechar Assistente" title="Fechar Assistente" onClick={onClose}>
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className={compact ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3" : "flex flex-col gap-4"}>
          <div
            ref={historicoRef}
            role="log"
            aria-label="Conversa com o Assistente"
            aria-live="polite"
            className={compact
              ? "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-border p-3"
              : "flex max-h-[65vh] min-h-64 flex-col gap-4 overflow-y-auto rounded-lg border border-border p-3 sm:p-4"}
          >
            {mensagens.map((mensagem) => (
              <div key={mensagem.id} className={mensagem.papel === "usuario" ? "flex justify-end" : "flex flex-col gap-2"}>
                <div
                  className={
                    mensagem.papel === "usuario"
                      ? "max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "w-fit max-w-[90%] rounded-xl bg-muted px-3 py-2 text-sm"
                  }
                >
                  {mensagem.pendente ? <Clock3 className="mr-2 inline size-3.5 animate-pulse" /> : null}
                  {mensagem.texto}
                </div>
                {mensagem.consulta ? (
                  <div className="w-full min-w-0">
                    <ResultadoConsulta consulta={mensagem.consulta} onSugerir={setLeadSugestao} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <form onSubmit={enviar} className="flex items-center gap-2">
            <Input
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              placeholder="Pergunte sobre leads, KPIs ou relatórios..."
              aria-label="Mensagem para o Assistente"
              disabled={pending}
            />
            <Button type="submit" size="icon" aria-label="Enviar consulta" disabled={pending || !texto.trim()}>
              {pending ? <Clock3 className="size-4 animate-pulse" /> : <Send className="size-4" />}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={ajudaAberta} onOpenChange={setAjudaAberta}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Funções do Assistente</DialogTitle>
            <DialogDescription>
              O Assistente não usa IA. Ele reconhece estas consultas e não envia mensagens automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            {EXEMPLOS_CONSULTA.map((exemplo) => (
              <Button
                key={exemplo}
                type="button"
                variant="outline"
                className="h-auto justify-start whitespace-normal py-2 text-left"
                onClick={() => {
                  setTexto(exemplo)
                  setAjudaAberta(false)
                }}
              >
                {exemplo}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={leadSugestao !== null} onOpenChange={(open) => !open && setLeadSugestao(null)}>
        <DialogContent className="sm:max-w-lg">
          {leadSugestao ? (
            <>
              <DialogHeader>
                <DialogTitle>Sugestão para {leadSugestao.nome}</DialogTitle>
                <DialogDescription>
                  Texto padrão personalizado pelo nome. Revise antes de usar; nenhuma mensagem será enviada por aqui.
                </DialogDescription>
              </DialogHeader>
              <Textarea readOnly rows={4} value={gerarSugestao(leadSugestao)} />
              <Button onClick={copiarSugestao} className="w-fit">
                <Copy className="size-4" />
                Copiar mensagem
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ResultadoConsulta({
  consulta,
  onSugerir,
}: {
  consulta: ConsultaAtual
  onSugerir: (lead: AssistenteLead) => void
}) {
  if (consulta.tipo === "kpis") return <KpisResultado kpis={consulta.kpis} />
  if (consulta.tipo === "relatorios") return <RelatoriosResultado dados={consulta.relatorios} />
  if (consulta.tipo === "dashboard") return <DashboardResultado dados={consulta.dashboard} />
  if (consulta.leads.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nenhum lead encontrado.</p>
  }

  const mostrarCampanha = consulta.tipo !== "semCampanhaAtiva"
  const tituloData = consulta.tipo === "respostasRecentes" ? "Última resposta" : "Último envio"

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {formatNumber(consulta.total)} {consulta.total === 1 ? "lead encontrado" : "leads encontrados"}
        {consulta.total > consulta.limite ? ` · exibindo ${formatNumber(consulta.limite)}` : ""}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead>Telefone</TableHead>
            {mostrarCampanha ? <TableHead>Campanha</TableHead> : null}
            {consulta.tipo !== "semCampanhaAtiva" ? <TableHead>{tituloData}</TableHead> : null}
            {consulta.tipo === "semResposta48h" ? <TableHead>Ação</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {consulta.leads.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="font-medium">{lead.nome}</TableCell>
              <TableCell className="font-mono text-xs">{lead.telefone}</TableCell>
              {mostrarCampanha ? <TableCell>{lead.campanha ?? "Sem campanha"}</TableCell> : null}
              {consulta.tipo !== "semCampanhaAtiva" ? (
                <TableCell className="whitespace-nowrap">{lead.referenciaEm ? formatDateTime(lead.referenciaEm) : "Sem envio"}</TableCell>
              ) : null}
              {consulta.tipo === "semResposta48h" ? (
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => onSugerir(lead)}>
                    <MessageSquareText className="size-4" />
                    Sugerir mensagem
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function KpisResultado({ kpis }: { kpis: Kpis }) {
  const indicadores = [
    { nome: "Leads ativos", valor: formatNumber(kpis.leadsAtivos), variacao: kpis.variacao.leadsAtivos },
    { nome: "Campanhas ativas", valor: formatNumber(kpis.campanhasAtivas), variacao: kpis.variacao.campanhasAtivas },
    { nome: "Mensagens enviadas hoje", valor: formatNumber(kpis.mensagensHoje), variacao: kpis.variacao.mensagensHoje },
    { nome: "Taxa de resposta", valor: formatPercent(kpis.taxaResposta), variacao: kpis.variacao.taxaResposta },
  ]

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Indicador</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Variação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {indicadores.map((indicador) => (
          <TableRow key={indicador.nome}>
            <TableCell className="font-medium">{indicador.nome}</TableCell>
            <TableCell>{indicador.valor}</TableCell>
            <TableCell>{indicador.variacao ? formatPercent(indicador.variacao) : "Estável"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function RelatoriosResultado({ dados }: { dados: AssistenteRelatorios }) {
  const segmentos = [
    ["Produto", dados.segmentos.produto],
    ["Marca", dados.segmentos.marca],
    ["Persona", dados.segmentos.persona],
    ["Região", dados.segmentos.regiao],
  ] as const

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Histórico completo, sem filtro de período.</p>
      <Tabs defaultValue="funil">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="mensagens">Mensagens</TabsTrigger>
          <TabsTrigger value="momentos">Dias e horários</TabsTrigger>
          <TabsTrigger value="segmentos">Segmentos</TabsTrigger>
        </TabsList>

        <TabsContent value="funil">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Leads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.funil.map((item) => (
                <TableRow key={item.etapa}>
                  <TableCell>{item.etapa}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(item.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="campanhas">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Envios</TableHead>
                <TableHead>Respostas</TableHead>
                <TableHead>Taxa de resposta</TableHead>
                <TableHead>Conversão</TableHead>
                <TableHead>Tempo médio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.campanhas.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.nome}</TableCell>
                  <TableCell>{formatNumber(item.leads)}</TableCell>
                  <TableCell>{formatNumber(item.enviadas)}</TableCell>
                  <TableCell>{formatNumber(item.respostas)}</TableCell>
                  <TableCell>{formatPercent(item.taxaResposta)}</TableCell>
                  <TableCell>{formatPercent(item.taxaConversao)}</TableCell>
                  <TableCell>{item.tempoMedioRespostaDias.toFixed(1)} dias</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="mensagens">
          <p className="mb-2 text-xs text-muted-foreground">8 mensagens com melhor taxa de resposta.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha / horário</TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead>Envios</TableHead>
                <TableHead>Respostas</TableHead>
                <TableHead>Taxa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.mensagens.slice(0, 8).map((item, index) => (
                <TableRow key={`${item.campanha}-${item.dia}-${index}`}>
                  <TableCell>{item.campanha} · Dia {item.dia} · {item.horario}</TableCell>
                  <TableCell className="max-w-xs truncate">{item.texto}</TableCell>
                  <TableCell>{formatNumber(item.enviadas)}</TableCell>
                  <TableCell>{formatNumber(item.respostas)}</TableCell>
                  <TableCell>{formatPercent(item.taxaResposta)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="momentos">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {[
              { titulo: "Dia da semana", dados: dados.dias },
              { titulo: "Faixa horária", dados: dados.horarios },
            ].map((grupo) => (
              <div key={grupo.titulo} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{grupo.titulo}</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Período</TableHead>
                      <TableHead>Envios</TableHead>
                      <TableHead>Respostas</TableHead>
                      <TableHead>Taxa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grupo.dados.map((item) => (
                      <TableRow key={item.label}>
                        <TableCell>{item.label}</TableCell>
                        <TableCell>{formatNumber(item.enviadas)}</TableCell>
                        <TableCell>{formatNumber(item.respostas)}</TableCell>
                        <TableCell>{formatPercent(item.taxa)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="segmentos">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dimensão</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Respostas</TableHead>
                <TableHead>Conversão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segmentos.flatMap(([dimensao, itens]) =>
                itens.map((item) => (
                  <TableRow key={`${dimensao}-${item.chave}`}>
                    <TableCell>{dimensao}</TableCell>
                    <TableCell className="font-medium">{item.chave || "Sem valor"}</TableCell>
                    <TableCell>{formatNumber(item.leads)}</TableCell>
                    <TableCell>{formatNumber(item.respostas)}</TableCell>
                    <TableCell>{formatPercent(item.taxaConversao)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DashboardResultado({ dados }: { dados: AssistenteDashboard }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Visão geral do Dashboard: atividade dos últimos 30 dias, indicadores atuais, funil e 8 eventos mais recentes.
      </p>
      <Tabs defaultValue="indicadores">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
          <TabsTrigger value="atividade">Atividade</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas eficientes</TabsTrigger>
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="eventos">Eventos recentes</TabsTrigger>
        </TabsList>

        <TabsContent value="indicadores">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indicador</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Variação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Leads ativos</TableCell>
                <TableCell>{formatNumber(dados.kpis.leadsAtivos)}</TableCell>
                <TableCell>{dados.kpis.variacao.leadsAtivos ? formatPercent(dados.kpis.variacao.leadsAtivos) : "Estável"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Campanhas ativas</TableCell>
                <TableCell>{formatNumber(dados.kpis.campanhasAtivas)}</TableCell>
                <TableCell>{dados.kpis.variacao.campanhasAtivas ? formatPercent(dados.kpis.variacao.campanhasAtivas) : "Estável"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Mensagens enviadas hoje</TableCell>
                <TableCell>{formatNumber(dados.kpis.mensagensHoje)}</TableCell>
                <TableCell>{dados.kpis.variacao.mensagensHoje ? formatPercent(dados.kpis.variacao.mensagensHoje) : "Estável"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Taxa de resposta</TableCell>
                <TableCell>{formatPercent(dados.kpis.taxaResposta)}</TableCell>
                <TableCell>{dados.kpis.variacao.taxaResposta ? formatPercent(dados.kpis.variacao.taxaResposta) : "Estável"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="atividade">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead>Mensagens enviadas</TableHead>
                <TableHead>Respostas recebidas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.atividade.map((item) => (
                <TableRow key={item.data}>
                  <TableCell>{item.label}</TableCell>
                  <TableCell>{formatNumber(item.enviadas)}</TableCell>
                  <TableCell>{formatNumber(item.respostas)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="campanhas">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Respostas</TableHead>
                <TableHead>Conversão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.campanhas.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.nome}</TableCell>
                  <TableCell>{formatNumber(item.leads)}</TableCell>
                  <TableCell>{formatNumber(item.respostas)}</TableCell>
                  <TableCell>{formatPercent(item.taxaConversao)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="funil">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead>Leads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.funil.map((item) => (
                <TableRow key={item.etapa}>
                  <TableCell>{item.etapa}</TableCell>
                  <TableCell>{formatNumber(item.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="eventos">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Campanha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.eventos.map((evento) => (
                <TableRow key={evento.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(evento.data)}</TableCell>
                  <TableCell className="max-w-sm">
                    <div className="flex flex-col">
                      <span>{evento.descricao}</span>
                      {evento.detalhes ? <span className="truncate text-xs text-muted-foreground">{evento.detalhes}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell>{evento.leadNome}</TableCell>
                  <TableCell>{evento.campanhaNome ?? "Envio avulso"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  )
}