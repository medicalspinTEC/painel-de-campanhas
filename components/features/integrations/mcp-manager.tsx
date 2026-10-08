"use client"

import { useEffect, useState, useTransition } from "react"
import { CheckCircle, CircleSlash, ClipboardCopy, RefreshCcw, Save, Trash2, TriangleAlert, Waypoints } from "lucide-react"
import { toast } from "sonner"

import { definirFerramentasMcpAction, definirMcpAtivoAction, gerarTokenMcpAction, revogarTokenMcpAction } from "@/app/actions/mcp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Spinner } from "@/components/ui/spinner"
import { formatDateTime } from "@/lib/format"
import {
  listaDePlugins,
  MCP_FERRAMENTAS,
  MCP_GRUPOS,
  MCP_TIPO_LABEL,
  pluginsFaltando,
  type McpFerramentaDef,
} from "@/lib/mcp/catalogo"
import type { PluginsAtivos } from "@/lib/plugins"
import type { McpStatus } from "@/services/mcp-token"

type Confirmacao = "trocar" | "remover" | null

/** Só consultas: ponto de partida seguro, sem nada que altere ou apague dados. */
const SOMENTE_CONSULTAS = MCP_FERRAMENTAS.filter((f) => f.tipo === "leitura").map((f) => f.nome)

function mesmaSelecao(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((nome) => b.includes(nome))
}

export function McpManager({ statusInicial, plugins }: { statusInicial: McpStatus | null; plugins: PluginsAtivos }) {
  const [status, setStatus] = useState<McpStatus | null>(statusInicial)
  // Funções marcadas na tela. Sem token ainda, parte das consultas (nada destrutivo vem marcado).
  const [selecionadas, setSelecionadas] = useState<string[]>(statusInicial?.ferramentas ?? SOMENTE_CONSULTAS)
  // O token em texto só existe aqui, logo após gerar: o servidor guarda apenas o hash.
  const [tokenNovo, setTokenNovo] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<Confirmacao>(null)
  const [pending, startTransition] = useTransition()
  const [baseUrl, setBaseUrl] = useState("")

  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])

  const endpoint = `${baseUrl}/api/mcp`

  function copiar(texto: string, rotulo: string) {
    navigator.clipboard.writeText(texto).then(() => toast.success(`${rotulo} copiado!`))
  }

  function gerar() {
    startTransition(async () => {
      const resultado = await gerarTokenMcpAction(selecionadas)
      if (resultado.ok && resultado.token) {
        setTokenNovo(resultado.token)
        setStatus({
          ativo: true,
          prefixo: resultado.token.slice(0, 12),
          ferramentas: selecionadas,
          criadoEm: new Date().toISOString(),
          ultimoUsoEm: null,
        })
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
      setConfirmar(null)
    })
  }

  function alternarFuncao(nome: string, marcada: boolean) {
    setSelecionadas((atuais) => (marcada ? [...new Set([...atuais, nome])] : atuais.filter((n) => n !== nome)))
  }

  function alternarGrupo(nomes: string[], marcar: boolean) {
    setSelecionadas((atuais) => (marcar ? [...new Set([...atuais, ...nomes])] : atuais.filter((n) => !nomes.includes(n))))
  }

  function salvarFuncoes() {
    startTransition(async () => {
      const resultado = await definirFerramentasMcpAction(selecionadas)
      if (resultado.ok) {
        setStatus((atual) => (atual ? { ...atual, ferramentas: selecionadas } : atual))
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  function alternar() {
    if (!status) return
    const ativo = !status.ativo
    startTransition(async () => {
      const resultado = await definirMcpAtivoAction(ativo)
      if (resultado.ok) {
        setStatus((atual) => (atual ? { ...atual, ativo } : atual))
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  function remover() {
    startTransition(async () => {
      const resultado = await revogarTokenMcpAction()
      if (resultado.ok) {
        setStatus(null)
        setTokenNovo(null)
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
      setConfirmar(null)
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Waypoints className="size-4 text-muted-foreground" aria-hidden="true" />
              MCP (Claude e outros assistentes)
              {status ? (
                status.ativo ? (
                  <Badge variant="outline" className="border-green-500/30 text-green-600 dark:text-green-400">
                    Ativo
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-destructive/30 text-destructive">
                    Desativado
                  </Badge>
                )
              ) : (
                <Badge variant="secondary">Desligado</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Conecta um assistente MCP aos dados desta instância. Vem desligado: escolha abaixo as funções que ele poderá
              executar e gere o token. A IA só enxerga o que você liberar aqui (não precisa configurar nada nela), e as
              funções de plugin só rodam com o plugin ativo. Vale apenas para esta instância, nunca para as outras.
            </CardDescription>
          </div>

          <div className="flex shrink-0 gap-2">
            {status ? (
              <>
                <Button variant="outline" size="sm" onClick={alternar} disabled={pending}>
                  {status.ativo ? <CircleSlash className="size-4" /> : <CheckCircle className="size-4" />}
                  {status.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmar("remover")} disabled={pending}>
                  <Trash2 className="size-4" />
                  Remover
                </Button>
              </>
            ) : null}
            <Button size="sm" onClick={status ? () => setConfirmar("trocar") : gerar} disabled={pending || selecionadas.length === 0}>
              {pending ? <Spinner className="size-4" /> : <RefreshCcw className="size-4" />}
              {status ? "Gerar novo token" : "Gerar token"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3 border-b pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Funções que o MCP poderá executar</span>
              <span className="text-xs text-muted-foreground">
                {selecionadas.length} de {MCP_FERRAMENTAS.length} liberadas
                {status ? " neste token" : " — escolha antes de gerar o token"}.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelecionadas(SOMENTE_CONSULTAS)} disabled={pending}>
                Só consultas
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelecionadas(MCP_FERRAMENTAS.map((f) => f.nome))} disabled={pending}>
                Todas
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelecionadas([])} disabled={pending}>
                Limpar
              </Button>
              {status ? (
                <Button size="sm" onClick={salvarFuncoes} disabled={pending || selecionadas.length === 0 || mesmaSelecao(selecionadas, status.ferramentas)}>
                  {pending ? <Spinner className="size-4" /> : <Save className="size-4" />}
                  Salvar funções
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {MCP_GRUPOS.map((grupo) => {
              const funcoes = MCP_FERRAMENTAS.filter((f) => f.grupo === grupo)
              const nomes = funcoes.map((f) => f.nome)
              const marcadas = nomes.filter((n) => selecionadas.includes(n)).length
              return (
                <div key={grupo} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={marcadas === nomes.length}
                      indeterminate={marcadas > 0 && marcadas < nomes.length}
                      onCheckedChange={(marcado) => alternarGrupo(nomes, Boolean(marcado))}
                      disabled={pending}
                    />
                    {grupo}
                    <span className="text-xs font-normal text-muted-foreground">
                      {marcadas}/{nomes.length}
                    </span>
                  </label>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {funcoes.map((funcao) => (
                      <LinhaFuncao
                        key={funcao.nome}
                        funcao={funcao}
                        plugins={plugins}
                        marcada={selecionadas.includes(funcao.nome)}
                        desabilitada={pending}
                        onChange={(marcada) => alternarFuncao(funcao.nome, marcada)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>

        {status ? (
          <CardContent className="flex flex-col gap-4">
            {tokenNovo ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <span className="text-xs font-medium">Copie agora — este token não será mostrado de novo.</span>
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                  <code className="flex-1 break-all font-mono text-xs">{tokenNovo}</code>
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={() => copiar(tokenNovo, "Token")} aria-label="Copiar token">
                    <ClipboardCopy className="size-4" />
                  </Button>
                </div>
                <span className="text-xs font-medium">URL para conectores que só pedem o endereço (ex.: Claude.ai)</span>
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                  <code className="flex-1 break-all font-mono text-xs">{`${endpoint}?token=${tokenNovo}`}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => copiar(`${endpoint}?token=${tokenNovo}`, "URL")}
                    aria-label="Copiar URL com token"
                  >
                    <ClipboardCopy className="size-4" />
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  Quem tiver esta URL acessa os dados desta instância: trate-a como uma senha. Quando o cliente permitir, prefira enviar o token no header
                  Authorization.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Token atual</span>
                <code className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">{status.prefixo}…</code>
                <span className="text-xs text-muted-foreground">
                  O token completo não é guardado. Se o perdeu, gere um novo (o atual deixa de funcionar).
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Endereço do MCP</span>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <code className="flex-1 break-all font-mono text-xs">{endpoint}</code>
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => copiar(endpoint, "Endereço")} aria-label="Copiar endereço">
                  <ClipboardCopy className="size-4" />
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{`Authorization: Bearer <token>\n# ou: x-mcp-token: <token>`}</pre>
            </div>

            <p className="text-xs text-muted-foreground">
              Criado em {formatDateTime(status.criadoEm)} ·{" "}
              {status.ultimoUsoEm ? `último uso em ${formatDateTime(status.ultimoUsoEm)}` : "ainda não foi usado"}
            </p>
          </CardContent>
        ) : null}
      </Card>

      <AlertDialog open={confirmar !== null} onOpenChange={(aberto) => !aberto && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === "remover" ? "Remover o token do MCP?" : "Gerar um novo token?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "remover"
                ? "O MCP desta instância volta a ficar desligado e os assistentes conectados param de funcionar."
                : "O token atual deixa de funcionar na hora. Atualize o conector de quem usa o MCP com o novo token."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmar === "remover" ? remover : gerar} disabled={pending}>
              {pending ? <Spinner /> : null}
              {confirmar === "remover" ? "Remover" : "Gerar novo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function LinhaFuncao({
  funcao,
  plugins,
  marcada,
  desabilitada,
  onChange,
}: {
  funcao: McpFerramentaDef
  plugins: PluginsAtivos
  marcada: boolean
  desabilitada: boolean
  onChange: (marcada: boolean) => void
}) {
  const faltando = pluginsFaltando(funcao, plugins)
  return (
    <label className="flex items-start gap-2 rounded-sm px-1 py-1 text-sm hover:bg-muted/50">
      <Checkbox className="mt-0.5" checked={marcada} disabled={desabilitada} onCheckedChange={(valor) => onChange(Boolean(valor))} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {funcao.titulo}
          {funcao.tipo === "exclusao" ? (
            <Badge variant="outline" className="border-destructive/30 text-destructive">
              {MCP_TIPO_LABEL.exclusao}
            </Badge>
          ) : funcao.tipo !== "leitura" ? (
            <Badge variant="secondary">{MCP_TIPO_LABEL[funcao.tipo]}</Badge>
          ) : null}
        </span>
        {funcao.plugins.length > 0 ? (
          faltando.length > 0 ? (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <TriangleAlert className="size-3" aria-hidden="true" />
              Plugin {listaDePlugins(faltando)} desativado: não executa até ativar
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Requer plugin {listaDePlugins(funcao.plugins)}</span>
          )
        ) : null}
      </span>
    </label>
  )
}
