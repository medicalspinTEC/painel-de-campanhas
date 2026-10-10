"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { ArrowLeft, Bot, FlaskConical, Loader2, Lock, RefreshCw, Save, Send } from "lucide-react"
import { toast } from "sonner"

import { listExecutionsAction, saveFlowAction, testFlowAction, toggleFlowAction } from "@/app/actions/nocode"
import { ExecutionItem, ExecutionsPanel } from "@/components/features/nocode/executions-panel"
import { ExecutionWebhookDialog } from "@/components/features/nocode/execution-webhook-dialog"
import { FlowCanvas, type Selecao } from "@/components/features/nocode/flow-canvas"
import { NodeConfigPanel } from "@/components/features/nocode/node-config-panel"
import { ICONES } from "@/components/features/nocode/node-visuals"
import { LinkButton } from "@/components/shared/link-button"
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
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  blocoPermitido,
  criarNo,
  gatilhoDoTipo,
  MENSAGEM_EXEMPLO_BOT,
  NODE_CATALOG,
  novoId,
  ORDEM_CATEGORIAS,
  PAYLOAD_EXEMPLO,
  podarArestas,
  type FlowEdge,
  type FlowNode,
  type NodeConfig,
  type NodeType,
} from "@/lib/nocode/catalog"
import { cn } from "@/lib/utils"
import type { ExecutionRow, FlowRow } from "@/services/nocode"

const VARIAVEIS_WEBHOOK = [
  "webhook.data.key.remoteJid",
  "webhook.data.key.fromMe",
  "webhook.data.pushName",
  "webhook.data.message.conversation",
]
const VARIAVEIS_BOT = [
  "mensagem",
  "telefone",
  "lead.nome",
  "lead.id",
  "lead.status",
  "departamento.nome",
]
const VARIAVEIS_CAMPANHA = ["campanha.id", "campanha.nome", "campanha.status"]
const VARIAVEIS_STATUS_LEAD = ["status_lead.anterior", "status_lead.atual"]
const VARIAVEIS_MENU = ["opcao.numero", "opcao.texto"]
const VARIAVEIS_LEAD = ["lead.encontrado", "lead.id", "lead.nome", "lead.status", "lead.temCampanha", "lead.campanhasIds"]

export function FlowEditor({
  fluxo,
  execucoesIniciais,
  totalExecucoes,
  atendentes = [],
  campanhas = [],
  crmAtivo = false,
}: {
  /** Atendentes ativos do CRM (para o bloco "Transferir para atendente"). */
  atendentes?: { id: string; nome: string }[]
  /** Campanhas não encerradas (para o bloco "Enviar lead para campanha"). */
  campanhas?: { id: string; nome: string; status: string }[]
  /** Plugin CRM ativo (libera status exclusivos dele no bloco "Alterar status do lead"). */
  crmAtivo?: boolean
  fluxo: FlowRow
  execucoesIniciais: ExecutionRow[]
  totalExecucoes: number
}) {
  const [nome, setNome] = useState(fluxo.nome)
  const [nodes, setNodes] = useState<FlowNode[]>(fluxo.nodes)
  const [edges, setEdges] = useState<FlowEdge[]>(fluxo.edges)
  const [ativo, setAtivo] = useState(fluxo.ativo)
  const sistema = fluxo.sistema
  const bot = fluxo.tipo === "bot"
  const [selecao, setSelecao] = useState<Selecao>(null)
  const [aba, setAba] = useState<"editor" | "execucoes">("editor")
  const [execucoes, setExecucoes] = useState(execucoesIniciais)
  const [total, setTotal] = useState(totalExecucoes)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [webhookCfg, setWebhookCfg] = useState(fluxo.webhookExecucoes)
  const [webhookAberto, setWebhookAberto] = useState(false)
  const [salvo, setSalvo] = useState(() => JSON.stringify({ nome: fluxo.nome, nodes: fluxo.nodes, edges: fluxo.edges }))
  const [pending, startTransition] = useTransition()
  const [testeAberto, setTesteAberto] = useState(false)
  const [payload, setPayload] = useState(() => JSON.stringify(bot ? MENSAGEM_EXEMPLO_BOT : PAYLOAD_EXEMPLO, null, 2))
  const [resultadoTeste, setResultadoTeste] = useState<ExecutionRow | null>(null)
  const [testando, setTestando] = useState(false)
  const centroRef = useRef<(() => { x: number; y: number }) | null>(null)

  const sujo = JSON.stringify({ nome, nodes, edges }) !== salvo
  const noSelecionado = selecao?.tipo === "no" ? nodes.find((n) => n.id === selecao.id) : undefined

  const variaveis = useMemo(() => {
    const campanha = [
      ...(nodes.some((n) => n.type === "enviar_lead_campanha") ? VARIAVEIS_CAMPANHA : []),
      ...(nodes.some((n) => n.type === "alterar_status_lead") ? VARIAVEIS_STATUS_LEAD : []),
      // “Cadastrar lead” deixa o lead (novo ou já existente) disponível como {{lead.*}}.
      ...(nodes.some((n) => n.type === "cadastrar_lead") ? VARIAVEIS_LEAD : []),
    ]
    if (bot) return [...new Set([...VARIAVEIS_BOT, ...(nodes.some((n) => n.type === "menu") ? VARIAVEIS_MENU : []), ...campanha])]
    const lista = [...VARIAVEIS_WEBHOOK]
    if (nodes.some((n) => n.type === "extrair_telefone")) lista.push("telefone")
    if (nodes.some((n) => n.type === "buscar_lead")) lista.push(...VARIAVEIS_LEAD)
    return [...new Set([...lista, ...campanha])]
  }, [nodes, bot])

  // Avisa antes de sair com alterações não salvas.
  useEffect(() => {
    if (!sujo) return
    function aviso(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", aviso)
    return () => window.removeEventListener("beforeunload", aviso)
  }, [sujo])

  const removerNo = useCallback((id: string) => {
    setNodes((atual) => atual.filter((n) => n.id !== id))
    setEdges((atual) => atual.filter((e) => e.source !== id && e.target !== id))
    setSelecao(null)
  }, [])

  const removerAresta = useCallback((id: string) => {
    setEdges((atual) => atual.filter((e) => e.id !== id))
    setSelecao(null)
  }, [])

  // Delete/Backspace remove o item selecionado (menos quando o foco está num campo).
  useEffect(() => {
    function aoTeclar(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return
      const alvo = event.target as HTMLElement | null
      if (alvo?.closest("input, textarea, select, [contenteditable='true'], [role='combobox']")) return
      if (!selecao) return
      event.preventDefault()
      if (selecao.tipo === "no") removerNo(selecao.id)
      else removerAresta(selecao.id)
    }
    window.addEventListener("keydown", aoTeclar)
    return () => window.removeEventListener("keydown", aoTeclar)
  }, [selecao, removerNo, removerAresta])

  function adicionar(tipo: NodeType) {
    const gatilho = gatilhoDoTipo(fluxo.tipo)
    if (tipo === gatilho && nodes.some((n) => n.type === gatilho)) {
      toast.error(`O fluxo já tem um gatilho “${NODE_CATALOG[gatilho].label}”.`)
      return
    }
    const centro = centroRef.current?.() ?? { x: 200, y: 160 }
    const deslocamento = (nodes.length % 5) * 16
    const no = criarNo(tipo, {
      x: Math.round((centro.x - 116 + deslocamento) / 8) * 8,
      y: Math.round((centro.y - 34 + deslocamento) / 8) * 8,
    })
    setNodes((atual) => [...atual, no])
    setSelecao({ tipo: "no", id: no.id })
  }

  function conectar(origem: string, saida: string, destino: string) {
    setEdges((atual) => {
      if (atual.some((e) => e.source === origem && e.sourceHandle === saida && e.target === destino)) return atual
      return [...atual, { id: novoId("e"), source: origem, sourceHandle: saida, target: destino }]
    })
  }

  async function salvarAgora(): Promise<boolean> {
    // Opções removidas de um menu deixam conexões órfãs: elas saem junto, em vez de impedir o salvamento.
    const arestas = podarArestas(nodes, edges)
    if (arestas.length !== edges.length) setEdges(arestas)
    const resultado = await saveFlowAction(fluxo.id, { nome, nodes, edges: arestas })
    if (!resultado.ok) {
      toast.error(resultado.message)
      return false
    }
    setSalvo(JSON.stringify({ nome, nodes, edges: arestas }))
    return true
  }

  function salvar() {
    startTransition(async () => {
      if (await salvarAgora()) toast.success("Fluxo salvo.")
    })
  }

  function alternarAtivo(valor: boolean) {
    if (sistema) return
    startTransition(async () => {
      if (sujo && !(await salvarAgora())) return
      const resultado = await toggleFlowAction(fluxo.id, valor)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      setAtivo(valor)
      toast.success(resultado.message)
    })
  }

  async function testar() {
    setTestando(true)
    try {
      const resultado = await testFlowAction(fluxo.id, { nodes, edges: podarArestas(nodes, edges), payload })
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      setResultadoTeste(resultado.execucao)
      setExecucoes((atual) => [resultado.execucao, ...atual])
      setTotal((atual) => atual + 1)
    } finally {
      setTestando(false)
    }
  }

  async function atualizarExecucoes() {
    const pagina = await listExecutionsAction(fluxo.id)
    if (pagina) {
      setExecucoes(pagina.itens)
      setTotal(pagina.total)
    } else toast.error("Não foi possível atualizar as execuções.")
  }

  async function carregarMaisExecucoes() {
    const ultima = execucoes[execucoes.length - 1]
    if (!ultima) return
    setCarregandoMais(true)
    try {
      const pagina = await listExecutionsAction(fluxo.id, ultima.id)
      if (!pagina) {
        toast.error("Não foi possível carregar mais execuções.")
        return
      }
      setExecucoes((atual) => {
        const vistos = new Set(atual.map((e) => e.id))
        return [...atual, ...pagina.itens.filter((e) => !vistos.has(e.id))]
      })
      setTotal(pagina.total)
    } finally {
      setCarregandoMais(false)
    }
  }

  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-136 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton variant="ghost" size="icon" aria-label="Voltar para os fluxos" href="/nocode">
          <ArrowLeft className="size-4" />
        </LinkButton>
        <Input
          value={nome}
          onChange={(event) => setNome(event.target.value)}
          maxLength={80}
          aria-label="Nome do fluxo"
          className="h-8 w-56 font-medium sm:w-72"
        />
        {sistema ? (
          <Badge variant="outline" title="Responde aos leads do app; não pode ser desativado nem excluído">
            <Lock className="size-3" />
            Fluxo do sistema
          </Badge>
        ) : null}
        {bot ? (
          <Badge variant="outline" title="Responde as conversas do chat (CRM → Departamentos)">
            <Bot className="size-3" />
            {fluxo.botEntrada ? "Bot de entrada" : fluxo.departamentoNome ? `Bot · ${fluxo.departamentoNome}` : "Bot sem departamento"}
          </Badge>
        ) : null}
        {sujo ? <Badge variant="secondary">Alterações não salvas</Badge> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={ativo}
              onCheckedChange={alternarAtivo}
              disabled={pending || sistema}
              title={sistema ? "Fluxo do sistema: sempre ativo" : undefined}
              aria-label="Ativar fluxo"
            />
            {ativo ? "Ativo" : "Desativado"}
          </label>
          <Button variant="outline" onClick={() => setWebhookAberto(true)}>
            <Send className="size-4" />
            Webhook de execuções
            {webhookCfg.ativo ? <Badge className="ml-1">Ativo</Badge> : null}
          </Button>
          <Button variant="outline" onClick={() => setTesteAberto(true)}>
            <FlaskConical className="size-4" />
            Testar
          </Button>
          <Button onClick={salvar} disabled={pending || !sujo || !nome.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b">
        {(["editor", "execucoes"] as const).map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => setAba(valor)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
              aba === valor ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {valor === "editor" ? "Editor" : `Execuções (${total})`}
          </button>
        ))}
        {aba === "execucoes" ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void atualizarExecucoes()}>
            <RefreshCw className="size-3.5" />
            Atualizar
          </Button>
        ) : null}
      </div>

      {aba === "execucoes" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ExecutionsPanel
            execucoes={execucoes}
            total={total}
            carregandoMais={carregandoMais}
            onCarregarMais={() => void carregarMaisExecucoes()}
            retencao={
              fluxo.sistema
                ? "As execuções deste fluxo ficam guardadas por 24 horas, sem limite de quantidade. Para guardá-las por mais tempo, use o webhook de execuções."
                : undefined
            }
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]">
          <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3 lg:flex">
            {ORDEM_CATEGORIAS.map((categoria) => (
              <div key={categoria} className="flex flex-col gap-1">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{categoria}</p>
                {Object.values(NODE_CATALOG)
                  .filter((def) => def.categoria === categoria && blocoPermitido(def.type, fluxo.tipo))
                  .map((def) => {
                    const Icone = ICONES[def.icone]
                    return (
                      <button
                        key={def.type}
                        type="button"
                        onClick={() => adicionar(def.type)}
                        title={def.descricao}
                        className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", def.cor)}>
                          <Icone className="size-3.5" />
                        </span>
                        <span className="leading-tight">{def.label}</span>
                      </button>
                    )
                  })}
              </div>
            ))}
            <p className="mt-auto px-1 text-[11px] leading-snug text-muted-foreground">
              Arraste do círculo de saída até a entrada de outro bloco para conectar. Delete remove o selecionado.
            </p>
          </aside>

          <div className="min-h-80 min-w-0 lg:min-h-0">
            <FlowCanvas
              nodes={nodes}
              edges={edges}
              selecao={selecao}
              onSelect={setSelecao}
              onMoverNo={(id, posicao) =>
                setNodes((atual) => atual.map((n) => (n.id === id ? { ...n, position: posicao } : n)))
              }
              onConectar={conectar}
              onRemoverAresta={removerAresta}
              centroRef={centroRef}
            />
          </div>

          <aside className="min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
            {noSelecionado ? (
              <NodeConfigPanel
                key={noSelecionado.id}
                no={noSelecionado}
                flowId={fluxo.id}
                variaveis={variaveis}
                atendentes={atendentes}
                campanhas={campanhas}
                crmAtivo={crmAtivo}
                onNome={(valor) =>
                  setNodes((atual) => atual.map((n) => (n.id === noSelecionado.id ? { ...n, name: valor } : n)))
                }
                onConfig={(patch: NodeConfig) =>
                  setNodes((atual) =>
                    atual.map((n) => (n.id === noSelecionado.id ? { ...n, config: { ...n.config, ...patch } } : n)),
                  )
                }
                onExcluir={() => removerNo(noSelecionado.id)}
              />
            ) : (
              <div className="flex flex-col gap-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Como montar</p>
                <ol className="list-decimal space-y-1.5 pl-4 leading-snug">
                  <li>Clique em um bloco à esquerda para adicioná-lo ao canvas.</li>
                  <li>Arraste do círculo de saída de um bloco até a entrada do próximo.</li>
                  <li>Clique num bloco para configurá-lo aqui.</li>
                  <li>Use “Testar” com um evento de exemplo, salve e ative o fluxo.</li>
                </ol>
                <p className="leading-snug">
                  Nos campos de texto você pode usar variáveis como <code>{"{{telefone}}"}</code> ou{" "}
                  <code>{"{{lead.nome}}"}</code>.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}

      <ExecutionWebhookDialog
        // Remonta a cada abertura: o formulário sempre começa com o que está salvo (o segredo nunca volta do servidor).
        key={webhookAberto ? "aberto" : "fechado"}
        open={webhookAberto}
        onOpenChange={setWebhookAberto}
        fluxoId={fluxo.id}
        config={webhookCfg}
        onSalvo={setWebhookCfg}
      />

      <Dialog open={testeAberto} onOpenChange={setTesteAberto}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Testar fluxo</DialogTitle>
            <DialogDescription>
              {bot
                ? "Roda o bot (mesmo sem salvar) como se o lead tivesse enviado a “mensagem” abaixo. Menus seguem a opção que essa mensagem escolher (ex.: \"1\"); nada é enviado e nenhuma conversa é alterada."
                : "Roda o fluxo (mesmo sem salvar) com o evento abaixo. A busca do lead lê o banco de verdade; registrar resposta e enviar mensagem são só simulados."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            rows={10}
            spellCheck={false}
            className="font-mono text-xs"
            aria-label="Evento de teste (JSON)"
          />
          {resultadoTeste ? <ExecutionItem key={resultadoTeste.id} execucao={resultadoTeste} aberto /> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTesteAberto(false)}>
              Fechar
            </Button>
            <Button onClick={() => void testar()} disabled={testando}>
              {testando ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
              Executar teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
