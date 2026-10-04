"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, Loader2, RefreshCw, Save, Send, XCircle } from "lucide-react"
import { toast } from "sonner"

import {
  iniciarBackupManualAction,
  listarBackupsAction,
  retentarBackupAction,
  salvarConfigBackupAction,
  testarWebhookBackupAction,
} from "@/app/actions/backup"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DIAS_SEMANA,
  INTERVALO_MAX_HORAS,
  INTERVALO_MIN_HORAS,
  descreverAgenda,
  type ModoAgenda,
} from "@/lib/backup/agenda"
import { SECOES_BACKUP, SECOES_PADRAO } from "@/lib/backup/secoes"
import type { BackupRow, ConfigBackup } from "@/services/backup"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

type Frequencia = "desligado" | ModoAgenda

function formatarData(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function nomesDasSecoes(chaves: string[]): string {
  return chaves.map((c) => SECOES_BACKUP.find((s) => s.chave === c)?.nome ?? c).join(", ")
}

function Passo({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="flex items-center gap-2 font-medium">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {numero}
        </span>
        {titulo}
      </h3>
      {children}
    </section>
  )
}

export function BackupPanel({
  configInicial,
  backupsIniciais,
  contagens,
  migrationPendente,
}: {
  configInicial: ConfigBackup
  backupsIniciais: BackupRow[]
  contagens: Record<string, number | null>
  migrationPendente: boolean
}) {
  const [url, setUrl] = useState(configInicial.url)
  const [segredo, setSegredo] = useState("")
  const [removerSegredo, setRemoverSegredo] = useState(false)
  const [temSegredo, setTemSegredo] = useState(configInicial.temSegredo)
  const [secoes, setSecoes] = useState<string[]>(configInicial.secoes)
  const [frequencia, setFrequencia] = useState<Frequencia>(
    configInicial.auto.ativo ? configInicial.auto.modo : "desligado",
  )
  // Mantém a última agenda escolhida mesmo com o automático desligado.
  const [modoSalvo] = useState<ModoAgenda>(configInicial.auto.modo)
  const [intervaloHoras, setIntervaloHoras] = useState(String(configInicial.auto.intervaloHoras))
  const [horario, setHorario] = useState(configInicial.auto.horario)
  const [diaSemana, setDiaSemana] = useState(String(configInicial.auto.diaSemana))
  const [proximoEm, setProximoEm] = useState(configInicial.auto.proximoEm)
  const [backups, setBackups] = useState<BackupRow[]>(backupsIniciais)

  const [salvando, startSalvar] = useTransition()
  const [iniciando, setIniciando] = useState(false)
  const [testando, setTestando] = useState(false)

  const autoAtivo = frequencia !== "desligado"
  const emAndamento = backups.some((b) => b.status === "enviando")
  const totalLinhas = useMemo(
    () =>
      SECOES_BACKUP.filter((s) => secoes.includes(s.chave)).reduce((soma, s) => soma + (contagens[s.chave] ?? 0), 0),
    [secoes, contagens],
  )

  // Enquanto há backup em curso, atualiza o histórico a cada poucos segundos.
  useEffect(() => {
    if (!emAndamento) return
    const timer = setInterval(async () => {
      const lista = await listarBackupsAction().catch(() => null)
      if (lista) setBackups(lista)
    }, 3000)
    return () => clearInterval(timer)
  }, [emAndamento])

  /** `undefined` = manter o segredo salvo; `null` = remover; texto = definir. */
  function valorSegredo(): string | null | undefined {
    if (removerSegredo) return null
    return segredo.trim() ? segredo : undefined
  }

  function alternarSecao(chave: string, marcada: boolean) {
    setSecoes((atual) => (marcada ? [...atual, chave] : atual.filter((c) => c !== chave)))
  }

  function entradaConfig() {
    return {
      url,
      segredo: valorSegredo(),
      secoes,
      auto: {
        ativo: autoAtivo,
        modo: autoAtivo ? frequencia : modoSalvo,
        intervaloHoras: Number(intervaloHoras),
        horario,
        diaSemana: Number(diaSemana),
      },
    }
  }

  function aplicarConfigSalva(config: ConfigBackup) {
    setTemSegredo(config.temSegredo)
    setProximoEm(config.auto.proximoEm)
    setSegredo("")
    setRemoverSegredo(false)
  }

  function salvar() {
    startSalvar(async () => {
      const resultado = await salvarConfigBackupAction(entradaConfig())
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      aplicarConfigSalva(resultado.config)
      toast.success(resultado.message)
    })
  }

  async function testar() {
    setTestando(true)
    try {
      const resultado = await testarWebhookBackupAction({ url, segredo: valorSegredo(), secoes })
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    } finally {
      setTestando(false)
    }
  }

  async function fazerBackup() {
    setIniciando(true)
    try {
      // Salva primeiro: o backup usa o destino salvo, e assim a tela e o banco ficam iguais.
      const salvo = await salvarConfigBackupAction(entradaConfig())
      if (!salvo.ok) {
        toast.error(salvo.message)
        return
      }
      aplicarConfigSalva(salvo.config)

      if (semUrl) {
        baixarArquivo()
        return
      }

      const resultado = await iniciarBackupManualAction({ secoes })
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      setBackups(resultado.backups)
      toast.success("Backup iniciado. O andamento aparece abaixo.")
    } finally {
      setIniciando(false)
    }
  }

  /** Baixa o backup como arquivo .json (não usa o webhook). */
  function baixarArquivo() {
    const link = document.createElement("a")
    link.href = `/api/backup/download?secoes=${encodeURIComponent(secoes.join(","))}`
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()
    toast.success("Gerando o arquivo. O download começa em instantes.")
    // O histórico mostra o "Download"; atualiza depois que ele começa a ser gravado.
    setTimeout(async () => {
      const lista = await listarBackupsAction().catch(() => null)
      if (lista) setBackups(lista)
    }, 1500)
  }

  async function baixarSalvando() {
    setIniciando(true)
    try {
      const salvo = await salvarConfigBackupAction(entradaConfig())
      if (!salvo.ok) {
        toast.error(salvo.message)
        return
      }
      aplicarConfigSalva(salvo.config)
      baixarArquivo()
    } finally {
      setIniciando(false)
    }
  }

  async function tentarDeNovo(id: string) {
    const resultado = await retentarBackupAction(id)
    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    setBackups(resultado.backups)
  }

  const semUrl = !url.trim()
  const semSecao = secoes.length === 0
  const ultimoOk = backups.find((b) => b.status === "enviado")

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <DatabaseBackup className="size-5" />
          Backup
        </h2>
        <p className="text-sm text-muted-foreground">
          Guarde uma cópia dos seus dados. Baixe um arquivo no seu computador ou envie para um servidor seu, e escolha o
          que salvar. O envio também pode ser automático.
        </p>
        <p className="text-xs text-muted-foreground">
          {ultimoOk ? `Último backup concluído: ${formatarData(ultimoOk.concluidoEm ?? ultimoOk.criadoEm)}.` : "Nenhum backup concluído ainda."}
        </p>
      </header>

      {migrationPendente ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>Não foi possível ler a configuração. Confira se a migration mais recente (backup) foi aplicada.</p>
        </div>
      ) : null}

      <Passo numero={1} titulo="Para onde enviar (opcional)">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-url">Endereço (URL) do webhook</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="backup-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://meu-servidor.com/backups"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
            <Button variant="outline" onClick={() => void testar()} disabled={testando || semUrl} className="shrink-0">
              {testando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Testar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {semUrl
              ? "Sem endereço, o backup é baixado como um arquivo no seu computador. Preencha só se quiser enviar para um servidor seu."
              : "Use \"Testar\" para conferir se o endereço responde antes de fazer o backup. Você também pode baixar o arquivo."}
          </p>
        </div>

        <details className="group rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground">
            Opções avançadas (segredo e detalhes técnicos)
          </summary>
          <div className="mt-3 flex flex-col gap-3 leading-relaxed">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="backup-segredo" className="text-foreground">
                Segredo para assinar o envio (opcional)
              </Label>
              <Input
                id="backup-segredo"
                type="password"
                value={segredo}
                onChange={(event) => {
                  setSegredo(event.target.value)
                  setRemoverSegredo(false)
                }}
                placeholder={temSegredo && !removerSegredo ? "Segredo definido — deixe em branco para manter" : "Sem segredo"}
                autoComplete="new-password"
                maxLength={200}
              />
              {temSegredo ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={removerSegredo}
                    onChange={(event) => {
                      setRemoverSegredo(event.target.checked)
                      if (event.target.checked) setSegredo("")
                    }}
                  />
                  Remover o segredo salvo
                </label>
              ) : null}
            </div>
            <p>
              Cada backup chega em várias partes (POST em JSON): <code>backup.parte</code> com <code>backup</code> (id,
              origem, seções), <code>parte</code> (tabela, índice) e <code>dados</code>; no fim, <code>backup.concluido</code>{" "}
              com o resumo de linhas por tabela. Headers: <code>X-Backup-Id</code>, <code>X-Backup-Event</code>,{" "}
              <code>X-Backup-Part</code>, <code>X-Backup-Attempt</code> e, com segredo,{" "}
              <code>X-Backup-Signature: sha256=…</code> (HMAC-SHA256 do corpo). Responda HTTP 2xx para confirmar cada
              parte.
            </p>
            <p>
              Senhas (hash) dos usuários e segredos de webhooks nunca são enviados. Os dados dos leads, como telefones,
              são: guarde o destino com cuidado.
            </p>
          </div>
        </details>
      </Passo>

      <Passo numero={2} titulo="O que salvar">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSecoes(SECOES_PADRAO)}>
            Só cadastros (recomendado)
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSecoes(SECOES_BACKUP.map((s) => s.chave))}>
            Tudo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSecoes([])}>
            Limpar
          </Button>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {SECOES_BACKUP.map((secao) => {
            const marcada = secoes.includes(secao.chave)
            const linhas = contagens[secao.chave]
            return (
              <li key={secao.chave}>
                <label
                  className={`flex h-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                    marcada ? "border-primary/60 bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={marcada}
                    onChange={(event) => alternarSecao(secao.chave, event.target.checked)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {secao.nome}
                      {secao.pesada ? <Badge variant="outline">pode ser grande</Badge> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{secao.descricao}</span>
                    <span className="text-xs text-muted-foreground">
                      {linhas === null || linhas === undefined
                        ? "Quantidade indisponível"
                        : `${linhas.toLocaleString("pt-BR")} registros`}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          {semSecao
            ? "Nenhuma seção selecionada."
            : `${secoes.length} ${secoes.length === 1 ? "seção selecionada" : "seções selecionadas"} · ${totalLinhas.toLocaleString("pt-BR")} registros hoje.`}
        </p>
      </Passo>

      <Passo numero={3} titulo="Quando fazer">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-frequencia">Backup automático</Label>
            <select
              id="backup-frequencia"
              className={SELECT_CLASS}
              value={frequencia}
              onChange={(event) => setFrequencia(event.target.value as Frequencia)}
            >
              <option value="desligado">Desligado (só manual)</option>
              <option value="diario">Todo dia</option>
              <option value="semanal">Toda semana</option>
              <option value="intervalo">A cada X horas</option>
            </select>
          </div>

          {frequencia === "intervalo" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="backup-intervalo">A cada quantas horas</Label>
              <Input
                id="backup-intervalo"
                type="number"
                min={INTERVALO_MIN_HORAS}
                max={INTERVALO_MAX_HORAS}
                value={intervaloHoras}
                onChange={(event) => setIntervaloHoras(event.target.value)}
              />
            </div>
          ) : null}

          {frequencia === "semanal" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="backup-dia">Dia da semana</Label>
              <select
                id="backup-dia"
                className={SELECT_CLASS}
                value={diaSemana}
                onChange={(event) => setDiaSemana(event.target.value)}
              >
                {DIAS_SEMANA.map((nome, i) => (
                  <option key={nome} value={i}>
                    {nome}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {frequencia === "diario" || frequencia === "semanal" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="backup-horario">Horário (Brasília)</Label>
              <Input id="backup-horario" type="time" value={horario} onChange={(event) => setHorario(event.target.value)} />
            </div>
          ) : null}
        </div>

        {semUrl ? (
          <p className="text-xs text-muted-foreground">
            O backup automático precisa do endereço do webhook (passo 1), porque não há como baixar um arquivo sozinho.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {autoAtivo
            ? `${descreverAgenda({
                modo: frequencia as ModoAgenda,
                intervaloHoras: Number(intervaloHoras) || 24,
                horario,
                diaSemana: Number(diaSemana),
              })}.${proximoEm ? ` Próximo backup: ${formatarData(proximoEm)}.` : " O próximo horário é marcado ao salvar."} Se o envio falhar, o app tenta de novo sozinho (até 5 vezes).`
            : "O automático está desligado. Use o botão abaixo para fazer um backup quando quiser."}
        </p>
      </Passo>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={salvar} disabled={salvando || iniciando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar
        </Button>
        {!semUrl ? (
          <Button variant="outline" onClick={() => void baixarSalvando()} disabled={iniciando || salvando || semSecao}>
            <Download className="size-4" />
            Baixar arquivo
          </Button>
        ) : null}
        <Button onClick={() => void fazerBackup()} disabled={iniciando || salvando || (!semUrl && emAndamento) || semSecao}>
          {iniciando || (!semUrl && emAndamento) ? (
            <Loader2 className="size-4 animate-spin" />
          ) : semUrl ? (
            <Download className="size-4" />
          ) : (
            <DatabaseBackup className="size-4" />
          )}
          {!semUrl && emAndamento ? "Backup em andamento…" : semUrl ? "Baixar backup" : "Enviar backup agora"}
        </Button>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h3 className="font-medium">Últimos backups</h3>
        {backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum backup feito ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {backups.map((backup) => (
              <li key={backup.id} className="flex flex-col gap-1.5 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {backup.status === "enviado" ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : backup.status === "falha" ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                    <span className="font-medium">
                      {backup.status === "enviado" ? (backup.origem === "download" ? "Baixado" : "Enviado") : backup.status === "falha" ? "Falhou" : backup.origem === "download" ? "Gerando…" : "Enviando…"}
                    </span>
                    <Badge variant="outline">{backup.origem === "manual" ? "Manual" : backup.origem === "download" ? "Download" : "Automático"}</Badge>
                    <span className="text-muted-foreground">{formatarData(backup.criadoEm)}</span>
                  </div>
                  {backup.status === "falha" && backup.origem !== "download" ? (
                    <Button size="sm" variant="outline" onClick={() => void tentarDeNovo(backup.id)}>
                      <RefreshCw className="size-3.5" />
                      Tentar de novo
                    </Button>
                  ) : null}
                </div>

                <p className="text-xs text-muted-foreground">{nomesDasSecoes(backup.secoes)}</p>

                {backup.status === "enviando" ? (
                  <p className="text-xs text-muted-foreground">
                    {backup.partesEnviadas} de ~{backup.partesTotal || "?"} partes · {formatarBytes(backup.bytes)}
                  </p>
                ) : null}

                {backup.status === "enviado" ? (
                  <p className="text-xs text-muted-foreground">
                    {Object.values(backup.resumo ?? {})
                      .reduce((soma, t) => soma + t.linhas, 0)
                      .toLocaleString("pt-BR")}{" "}
                    registros · {formatarBytes(backup.bytes)}
                    {backup.tentativas > 1 ? ` · ${backup.tentativas} tentativas` : ""}
                  </p>
                ) : null}

                {backup.status === "falha" ? (
                  <p className="text-xs text-destructive">
                    {backup.erro ?? "Falha desconhecida."}
                    {backup.vaiTentarDeNovo ? " O app vai tentar de novo automaticamente." : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
