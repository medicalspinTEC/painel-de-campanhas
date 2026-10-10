"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Send,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import {
  cancelarPushAction,
  carregarPainelPushAction,
  enviarAgoraPushAction,
  excluirPushAction,
  gerarChavesVapidAction,
  type PainelPush,
} from "@/app/actions/push"
import { PushDispositivoCard } from "@/components/features/push/push-dispositivo-card"
import { PushFormDialog } from "@/components/features/push/push-form-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { nomeDoNivel } from "@/lib/permissoes"
import {
  FUSO_PUSH,
  NOME_PLATAFORMA,
  NOME_STATUS_PUSH,
  STATUS_EDITAVEIS,
  descreverPublico,
  type PushItem,
  type StatusPush,
} from "@/lib/push"

function formatarData(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO_PUSH })
}

function copiar(texto: string) {
  void navigator.clipboard
    .writeText(texto)
    .then(() => toast.success("Copiado."))
    .catch(() => toast.error("Não foi possível copiar."))
}

const COR_STATUS: Record<StatusPush, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  agendada: "secondary",
  enviando: "secondary",
  enviada: "default",
  cancelada: "outline",
  falha: "destructive",
}

function Estatistica({ rotulo, valor }: { rotulo: string; valor: number | string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="text-xl font-semibold tabular-nums">{valor}</span>
    </div>
  )
}

function ConfiguracaoCard({ faltando }: { faltando: string[] }) {
  const [chaves, setChaves] = useState<{ publicKey: string; privateKey: string } | null>(null)
  const [gerando, setGerando] = useState(false)

  async function gerar() {
    setGerando(true)
    try {
      const resultado = await gerarChavesVapidAction()
      if (resultado.ok) setChaves({ publicKey: resultado.publicKey, privateKey: resultado.privateKey })
      else toast.error(resultado.message)
    } finally {
      setGerando(false)
    }
  }

  const linhas = chaves
    ? `VAPID_PUBLIC_KEY=${chaves.publicKey}\nVAPID_PRIVATE_KEY=${chaves.privateKey}\nVAPID_SUBJECT=mailto:seu-email@suaempresa.com`
    : ""

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          Configure as chaves de envio
        </CardTitle>
        <CardDescription>
          Para enviar notificações, o servidor precisa das chaves VAPID. Falta definir: {faltando.join(", ")}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Gere o par de chaves abaixo (ou use o comando <code>npx web-push generate-vapid-keys</code>).</li>
          <li>
            Cadastre as três variáveis de ambiente no servidor (Docker/Dokploy) e reinicie o app. O <code>VAPID_SUBJECT</code>{" "}
            é um e-mail de contato no formato <code>mailto:…</code> ou o endereço https do app.
          </li>
          <li>Guarde a chave privada em segredo e não troque as chaves depois: isso desativa as notificações de todos os aparelhos.</li>
        </ol>
        {chaves ? (
          <div className="flex flex-col gap-2">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{linhas}</pre>
            <div>
              <Button variant="outline" size="sm" onClick={() => copiar(linhas)}>
                <Copy className="size-3.5" />
                Copiar variáveis
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Estas chaves não ficam salvas no painel: copie agora.</p>
          </div>
        ) : (
          <div>
            <Button variant="outline" onClick={() => void gerar()} disabled={gerando}>
              {gerando ? <Spinner /> : <KeyRound className="size-4" />}
              Gerar chaves
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function PushManager({ inicial }: { inicial: PainelPush }) {
  const [painel, setPainel] = useState<PainelPush>(inicial)
  const [dialogAberto, setDialogAberto] = useState(false)
  const [modelo, setModelo] = useState<PushItem | null>(null)
  const [editando, setEditando] = useState(false)
  const [excluindo, setExcluindo] = useState<PushItem | null>(null)
  const [pending, startTransition] = useTransition()

  const { resumo, itens, aparelhos, usuarios } = painel
  const emEnvio = itens.some((n) => n.status === "enviando")

  const recarregar = useCallback(async () => {
    const novo = await carregarPainelPushAction().catch(() => null)
    if (novo) setPainel(novo)
  }, [])

  // Enquanto há envio em andamento, acompanha o progresso.
  useEffect(() => {
    if (!emEnvio) return
    const timer = setInterval(() => void recarregar(), 3000)
    return () => clearInterval(timer)
  }, [emEnvio, recarregar])

  // Agendadas que chegam na hora: atualiza a lista sem recarregar a página.
  useEffect(() => {
    const proxima = itens
      .filter((n) => n.status === "agendada" && n.agendadaPara)
      .map((n) => new Date(n.agendadaPara as string).getTime())
      .sort((a, b) => a - b)[0]
    if (!proxima) return
    const espera = Math.min(Math.max(proxima - Date.now() + 40_000, 5_000), 10 * 60_000)
    const timer = setTimeout(() => void recarregar(), espera)
    return () => clearTimeout(timer)
  }, [itens, recarregar])

  function abrirNova() {
    setModelo(null)
    setEditando(false)
    setDialogAberto(true)
  }
  function abrirEdicao(n: PushItem) {
    setModelo(n)
    setEditando(true)
    setDialogAberto(true)
  }
  function abrirDuplicar(n: PushItem) {
    setModelo(n)
    setEditando(false)
    setDialogAberto(true)
  }

  function executar(acao: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const resultado = await acao()
      if (resultado.ok) toast.success(resultado.message ?? "Pronto.")
      else toast.error(resultado.message ?? "Não foi possível concluir.")
      await recarregar()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {!resumo.configurado ? <ConfiguracaoCard faltando={resumo.faltando} /> : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="size-4" />
              Aparelhos inscritos
              {resumo.configurado ? (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="size-3 text-emerald-600" />
                  Envio configurado
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>Quem aceitou receber notificações neste painel. Só esses aparelhos podem ser alcançados.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Estatistica rotulo="Aparelhos" valor={resumo.aparelhos} />
            <Estatistica rotulo="Com o app instalado" valor={resumo.instalados} />
            <Estatistica rotulo="Usuários" valor={resumo.usuarios} />
            <Estatistica
              rotulo="iOS · Android · PC"
              valor={`${resumo.porPlataforma.ios} · ${resumo.porPlataforma.android} · ${resumo.porPlataforma.desktop}`}
            />
          </CardContent>
        </Card>
        <PushDispositivoCard />
      </div>

      <Tabs defaultValue="envios">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="envios">
              <BellRing className="size-4" />
              Envios
            </TabsTrigger>
            <TabsTrigger value="aparelhos">
              <Smartphone className="size-4" />
              Aparelhos
            </TabsTrigger>
          </TabsList>
          <Button onClick={abrirNova}>
            <Plus className="size-4" />
            Nova notificação
          </Button>
        </div>

        <TabsContent value="envios" className="mt-4">
          {itens.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma notificação ainda. Crie a primeira para avisar quem instalou o app.
              </CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {itens.map((n) => {
                const editavel = (STATUS_EDITAVEIS as readonly StatusPush[]).includes(n.status)
                return (
                  <li key={n.id}>
                    <Card>
                      <CardContent className="flex flex-col gap-3 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{n.titulo}</span>
                              <Badge variant={COR_STATUS[n.status]} className="gap-1">
                                {n.status === "enviando" ? <Loader2 className="size-3 animate-spin" /> : null}
                                {n.status === "agendada" ? <CalendarClock className="size-3" /> : null}
                                {n.status === "falha" ? <XCircle className="size-3" /> : null}
                                {NOME_STATUS_PUSH[n.status]}
                              </Badge>
                              {n.urgente ? <Badge variant="outline">Prioridade alta</Badge> : null}
                            </div>
                            <p className="whitespace-pre-line text-sm text-muted-foreground">{n.corpo}</p>
                            <p className="text-xs text-muted-foreground">
                              {descreverPublico(n)} · abre {n.url}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {n.status === "agendada" && n.agendadaPara
                                ? `Agendada para ${formatarData(n.agendadaPara)}`
                                : n.enviadaEm
                                  ? `Enviada em ${formatarData(n.enviadaEm)}`
                                  : `Criada em ${formatarData(n.criadoEm)}`}
                              {n.criadoPorNome ? ` por ${n.criadoPorNome}` : ""}
                            </p>
                            {n.status === "enviando" || n.status === "enviada" || (n.status === "falha" && n.totalAlvos > 0) ? (
                              <p className="text-xs text-muted-foreground">
                                {n.enviados} de {n.totalAlvos} {n.totalAlvos === 1 ? "aparelho recebeu" : "aparelhos receberam"}
                                {n.falhas ? ` · ${n.falhas} falha${n.falhas === 1 ? "" : "s"}` : ""}
                                {n.removidos ? ` · ${n.removidos} aparelho${n.removidos === 1 ? "" : "s"} inválido${n.removidos === 1 ? "" : "s"} removido${n.removidos === 1 ? "" : "s"}` : ""}
                              </p>
                            ) : null}
                            {n.erro ? <p className="text-xs text-destructive">{n.erro}</p> : null}
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            {editavel ? (
                              <>
                                <Button variant="outline" size="sm" onClick={() => abrirEdicao(n)}>
                                  <Pencil className="size-3.5" />
                                  Editar
                                </Button>
                                <Button variant="outline" size="sm" disabled={pending || !resumo.configurado} onClick={() => executar(() => enviarAgoraPushAction(n.id))}>
                                  <Send className="size-3.5" />
                                  {n.status === "falha" ? "Reenviar" : "Enviar agora"}
                                </Button>
                              </>
                            ) : null}
                            {n.status === "agendada" ? (
                              <Button variant="outline" size="sm" disabled={pending} onClick={() => executar(() => cancelarPushAction(n.id))}>
                                <XCircle className="size-3.5" />
                                Cancelar envio
                              </Button>
                            ) : null}
                            <Button variant="outline" size="sm" onClick={() => abrirDuplicar(n)}>
                              <Copy className="size-3.5" />
                              Duplicar
                            </Button>
                            {n.status !== "enviando" ? (
                              <Button variant="outline" size="sm" onClick={() => setExcluindo(n)}>
                                <Trash2 className="size-3.5" />
                                Excluir
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="aparelhos" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {aparelhos.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhum aparelho inscrito ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Aparelho</TableHead>
                        <TableHead>App instalado</TableHead>
                        <TableHead>Inscrito em</TableHead>
                        <TableHead>Último envio</TableHead>
                        <TableHead>Falhas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aparelhos.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{a.usuarioNome}</span>
                              <span className="text-xs text-muted-foreground">{nomeDoNivel(a.usuarioNivel)}</span>
                            </div>
                          </TableCell>
                          <TableCell>{NOME_PLATAFORMA[a.plataforma]}</TableCell>
                          <TableCell>{a.instalado ? "Sim" : "Não"}</TableCell>
                          <TableCell>{formatarData(a.criadoEm)}</TableCell>
                          <TableCell>{formatarData(a.ultimoEnvioEm)}</TableCell>
                          <TableCell>{a.falhas}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PushFormDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        modelo={modelo}
        editando={editando}
        usuarios={usuarios}
        configurado={resumo.configurado}
        onSalvo={() => void recarregar()}
      />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir notificação?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `“${excluindo.titulo}” sai da lista${excluindo.status === "agendada" ? " e o envio agendado não acontece" : ""}. Quem já recebeu continua com a notificação no aparelho.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const alvo = excluindo
                setExcluindo(null)
                if (alvo) executar(() => excluirPushAction(alvo.id))
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
