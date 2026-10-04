"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, FileUp, Loader2, RotateCcw, Search, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BYTES_CABECALHO,
  LIMITE_ARQUIVO_BYTES,
  lerCabecalhoBackup,
  totalIgnorados,
  type CabecalhoBackup,
  type EventoRestauracao,
  type ModoRestauracao,
  type ResultadoRestauracao,
} from "@/lib/backup/formato"
import { SECOES_BACKUP, SECOES_POR_CHAVE } from "@/lib/backup/secoes"

/** Seções que só o root restaura (a rota também confere). */
const SECOES_SO_ROOT = ["usuarios"]

type Etapa = "parado" | "enviando" | "processando"

interface Andamento {
  simulacao: boolean
  /** 0 a 1 (envio do arquivo). */
  envio: number
  mensagem: string
  tabela?: string
  feitas?: number
  total?: number
  tabelasConcluidas?: number
  totalTabelas?: number
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatarData(iso: string): string {
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

function formatarDuracao(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * Envia o arquivo como corpo cru (sem multipart) e lê a resposta NDJSON aos poucos.
 * XMLHttpRequest porque o `fetch` não informa o progresso do envio.
 */
function enviarRestauracao(
  arquivo: File,
  consulta: URLSearchParams,
  ouvinte: { aoEnvio: (fracao: number) => void; aoEvento: (evento: EventoRestauracao) => void },
): { promessa: Promise<ResultadoRestauracao>; cancelar: () => void } {
  const xhr = new XMLHttpRequest()

  const promessa = new Promise<ResultadoRestauracao>((resolver, rejeitar) => {
    let lidos = 0
    let resto = ""
    let resultado: ResultadoRestauracao | null = null
    let erroDoServidor: string | null = null

    const consumir = (final: boolean) => {
      resto += xhr.responseText.slice(lidos)
      lidos = xhr.responseText.length
      const linhas = resto.split("\n")
      resto = final ? "" : (linhas.pop() ?? "")
      if (final && linhas.length && linhas[linhas.length - 1] === "") linhas.pop()
      for (const linha of linhas) {
        if (!linha.trim()) continue
        let evento: EventoRestauracao
        try {
          evento = JSON.parse(linha) as EventoRestauracao
        } catch {
          continue
        }
        if (evento.tipo === "fim") resultado = evento.resultado
        else if (evento.tipo === "erro") erroDoServidor = evento.mensagem
        ouvinte.aoEvento(evento)
      }
    }

    xhr.open("POST", `/api/backup/restaurar?${consulta.toString()}`)
    xhr.setRequestHeader("content-type", "application/json")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) ouvinte.aoEnvio(e.loaded / e.total)
    }
    xhr.upload.onload = () => ouvinte.aoEnvio(1)
    xhr.onprogress = () => {
      if (xhr.status === 200) consumir(false)
    }
    xhr.onerror = () => rejeitar(new Error("A conexão com o servidor falhou durante o envio."))
    xhr.onabort = () => rejeitar(new Error("Envio cancelado."))
    xhr.ontimeout = () => rejeitar(new Error("O servidor demorou demais para responder."))
    xhr.onload = () => {
      if (xhr.status !== 200) {
        let mensagem = `O servidor recusou o arquivo (HTTP ${xhr.status}).`
        try {
          const corpo = JSON.parse(xhr.responseText) as { erro?: string }
          if (corpo?.erro) mensagem = corpo.erro
        } catch {
          // Resposta que não é JSON (ex.: página de erro de um proxy): fica a mensagem padrão.
        }
        rejeitar(new Error(mensagem))
        return
      }
      consumir(true)
      if (erroDoServidor) rejeitar(new Error(erroDoServidor))
      else if (resultado) resolver(resultado)
      else rejeitar(new Error("A resposta terminou sem o resultado. Confira em Logs se a restauração foi concluída."))
    }
    xhr.send(arquivo)
  })

  return { promessa, cancelar: () => xhr.abort() }
}

function rotuloTabela(tabela: string, secao: string): string {
  return `${tabela} (${SECOES_POR_CHAVE[secao]?.nome ?? secao})`
}

function Resultado({ resultado }: { resultado: ResultadoRestauracao }) {
  const soma = (campo: "noArquivo" | "novos" | "existentes" | "atualizados") =>
    resultado.tabelas.reduce((total, t) => total + t[campo], 0)
  const ignorados = resultado.tabelas.reduce((total, t) => total + totalIgnorados(t), 0)
  const verbo = resultado.simulacao ? "seriam" : "foram"
  const comAmostras = resultado.tabelas.filter((t) => t.amostras.length > 0)

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        {resultado.simulacao ? (
          <Search className="size-4 text-muted-foreground" />
        ) : ignorados > 0 ? (
          <AlertTriangle className="size-4 text-amber-600" />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-600" />
        )}
        <h3 className="font-medium">{resultado.simulacao ? "Análise concluída (nada foi gravado)" : "Restauração concluída"}</h3>
        <Badge variant="outline">{resultado.modo === "mesclar" ? "Mesclar" : "Sobrescrever"}</Badge>
        <span className="text-xs text-muted-foreground">{formatarDuracao(resultado.duracaoMs)}</span>
      </div>

      <p className="text-sm">
        {soma("novos").toLocaleString("pt-BR")} {verbo} criados
        {resultado.modo === "sobrescrever" ? `, ${soma("atualizados").toLocaleString("pt-BR")} ${verbo} atualizados` : ""}
        ; {soma("existentes").toLocaleString("pt-BR")} já existiam
        {ignorados > 0 ? `; ${ignorados.toLocaleString("pt-BR")} ${verbo} ignorados` : ""}.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">Tabela</th>
              <th className="px-3 py-1.5 text-right font-medium">No arquivo</th>
              <th className="px-3 py-1.5 text-right font-medium">Novos</th>
              <th className="px-3 py-1.5 text-right font-medium">Já existiam</th>
              {resultado.modo === "sobrescrever" ? <th className="px-3 py-1.5 text-right font-medium">Atualizados</th> : null}
              <th className="py-1.5 pl-3 text-right font-medium">Ignorados</th>
            </tr>
          </thead>
          <tbody>
            {resultado.tabelas.map((t) => (
              <tr key={t.tabela} className="border-b last:border-0">
                <td className="py-1.5 pr-3">{rotuloTabela(t.tabela, t.secao)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t.noArquivo.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t.novos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t.existentes.toLocaleString("pt-BR")}</td>
                {resultado.modo === "sobrescrever" ? (
                  <td className="px-3 py-1.5 text-right tabular-nums">{t.atualizados.toLocaleString("pt-BR")}</td>
                ) : null}
                <td className={`py-1.5 pl-3 text-right tabular-nums ${totalIgnorados(t) ? "text-amber-600" : ""}`}>
                  {totalIgnorados(t).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resultado.avisos.length ? (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          {resultado.avisos.map((aviso) => (
            <li key={aviso} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>{aviso}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {comAmostras.length ? (
        <details className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground">Exemplos do que foi ignorado</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {comAmostras.map((t) => (
              <li key={t.tabela}>
                <span className="font-medium text-foreground">{t.tabela}</span>
                <ul className="ml-4 list-disc">
                  {t.amostras.map((texto) => (
                    <li key={texto}>{texto}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

export function RestorePanel({ podeRestaurarUsuarios }: { podeRestaurarUsuarios: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelarRef = useRef<(() => void) | null>(null)

  const [arquivo, setArquivo] = useState<File | null>(null)
  const [cabecalho, setCabecalho] = useState<CabecalhoBackup | null>(null)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [secoes, setSecoes] = useState<string[]>([])
  const [modo, setModo] = useState<ModoRestauracao>("mesclar")
  const [etapa, setEtapa] = useState<Etapa>("parado")
  const [andamento, setAndamento] = useState<Andamento | null>(null)
  const [resultado, setResultado] = useState<ResultadoRestauracao | null>(null)
  const [erroExecucao, setErroExecucao] = useState<string | null>(null)

  const ocupado = etapa !== "parado"
  const secoesDoArquivo = new Set(cabecalho?.secoes ?? [])
  const podeEscolher = (chave: string) =>
    secoesDoArquivo.has(chave) && (podeRestaurarUsuarios || !SECOES_SO_ROOT.includes(chave))
  const semSecao = secoes.length === 0

  async function escolherArquivo(novo: File | null) {
    setResultado(null)
    setErroExecucao(null)
    setCabecalho(null)
    setSecoes([])
    setErroArquivo(null)
    setArquivo(novo)
    if (!novo) return

    if (novo.size > LIMITE_ARQUIVO_BYTES) {
      setErroArquivo(`O arquivo passa de ${formatarBytes(LIMITE_ARQUIVO_BYTES)}, que é o limite aceito.`)
      return
    }
    const lido = lerCabecalhoBackup(await novo.slice(0, BYTES_CABECALHO).text())
    if (!lido.ok) {
      setErroArquivo(lido.erro)
      return
    }
    setCabecalho(lido.cabecalho)
    // Sugere tudo o que o arquivo traz, menos o que este usuário não pode restaurar.
    setSecoes(
      SECOES_BACKUP.filter(
        (s) => lido.cabecalho.secoes.includes(s.chave) && (podeRestaurarUsuarios || !SECOES_SO_ROOT.includes(s.chave)),
      ).map((s) => s.chave),
    )
  }

  function alternarSecao(chave: string, marcada: boolean) {
    setResultado(null)
    setSecoes((atual) => (marcada ? [...atual, chave] : atual.filter((c) => c !== chave)))
  }

  async function executar(simular: boolean) {
    if (!arquivo || semSecao) return
    if (!simular) {
      const aviso =
        modo === "sobrescrever"
          ? "Restaurar em modo SOBRESCREVER?\n\nOs registros que já existem (mesmo id) serão substituídos pelos dados do backup. O que só existe no banco é mantido. Não há como desfazer."
          : "Restaurar o backup agora?\n\nSó o que falta será adicionado; o que já existe não é alterado."
      if (!window.confirm(aviso)) return
    }

    setResultado(null)
    setErroExecucao(null)
    setEtapa("enviando")
    setAndamento({ simulacao: simular, envio: 0, mensagem: "Enviando o arquivo…" })

    const consulta = new URLSearchParams({ secoes: secoes.join(","), modo, simular: simular ? "1" : "0" })
    const envio = enviarRestauracao(arquivo, consulta, {
      aoEnvio: (fracao) => {
        setAndamento((a) => (a ? { ...a, envio: fracao } : a))
        if (fracao >= 1) {
          setEtapa("processando")
          cancelarRef.current = null
        }
      },
      aoEvento: (evento) => {
        if (evento.tipo === "fase") setAndamento((a) => (a ? { ...a, mensagem: evento.mensagem } : a))
        else if (evento.tipo === "progresso") {
          setAndamento((a) =>
            a
              ? {
                  ...a,
                  mensagem: simular ? "Analisando…" : "Restaurando…",
                  tabela: evento.tabela,
                  feitas: evento.feitas,
                  total: evento.total,
                  tabelasConcluidas: evento.tabelasConcluidas,
                  totalTabelas: evento.totalTabelas,
                }
              : a,
          )
        }
      },
    })
    cancelarRef.current = envio.cancelar

    try {
      const final = await envio.promessa
      setResultado(final)
      if (simular) toast.success("Análise concluída. Nada foi gravado.")
      else {
        toast.success("Restauração concluída.")
        router.refresh()
      }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Não foi possível restaurar o backup."
      setErroExecucao(mensagem)
      toast.error(mensagem)
    } finally {
      cancelarRef.current = null
      setEtapa("parado")
      setAndamento(null)
    }
  }

  const percentualTabela =
    andamento?.total && andamento.feitas !== undefined ? Math.min(100, Math.round((andamento.feitas / andamento.total) * 100)) : 0
  const percentualEnvio = Math.round((andamento?.envio ?? 0) * 100)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <RotateCcw className="size-5" />
          Restaurar um backup
        </h2>
        <p className="text-sm text-muted-foreground">
          Recupere os dados a partir de um arquivo .json gerado por &quot;Baixar backup&quot;. Nada é apagado: o que só existe
          hoje no sistema é mantido, e rodar o mesmo arquivo de novo não duplica nada.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h3 className="font-medium">1. Arquivo do backup</h3>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          disabled={ocupado}
          onChange={(event) => {
            void escolherArquivo(event.target.files?.[0] ?? null)
            event.target.value = ""
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={ocupado}>
            <FileUp className="size-4" />
            {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
          </Button>
          {arquivo ? (
            <span className="text-sm text-muted-foreground">
              {arquivo.name} · {formatarBytes(arquivo.size)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Nenhum arquivo escolhido.</span>
          )}
        </div>

        {erroArquivo ? (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            {erroArquivo}
          </p>
        ) : null}

        {cabecalho ? (
          <p className="text-xs text-muted-foreground">
            Backup gerado em {formatarData(cabecalho.geradoEm)} · formato v{cabecalho.versao} · {cabecalho.secoes.length}{" "}
            {cabecalho.secoes.length === 1 ? "seção" : "seções"} no arquivo.
          </p>
        ) : null}
      </section>

      {cabecalho ? (
        <>
          <section className="flex flex-col gap-3 rounded-xl border p-4">
            <h3 className="font-medium">2. O que restaurar</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SECOES_BACKUP.map((secao) => {
                const noArquivo = secoesDoArquivo.has(secao.chave)
                const permitida = podeEscolher(secao.chave)
                const marcada = secoes.includes(secao.chave)
                return (
                  <li key={secao.chave}>
                    <label
                      className={`flex h-full items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                        !permitida
                          ? "cursor-not-allowed opacity-50"
                          : marcada
                            ? "cursor-pointer border-primary/60 bg-primary/5"
                            : "cursor-pointer hover:bg-muted/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={marcada}
                        disabled={!permitida || ocupado}
                        onChange={(event) => alternarSecao(secao.chave, event.target.checked)}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {secao.nome}
                          {secao.pesada ? <Badge variant="outline">pode ser grande</Badge> : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {!noArquivo
                            ? "Não está neste arquivo."
                            : !permitida
                              ? "Só o root pode restaurar usuários."
                              : secao.descricao}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Algumas seções dependem de outras (ex.: leads dependem de campanhas e usuários). Registros cujo vínculo não
              existe nem no arquivo nem no sistema são ignorados e aparecem no resultado.
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border p-4">
            <h3 className="font-medium">3. Se o registro já existir</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["mesclar", "Mesclar (recomendado)", "Só adiciona o que falta. O que já existe não é alterado."],
                  [
                    "sobrescrever",
                    "Sobrescrever",
                    "Também substitui os dados dos registros que já existem (mesmo id) pelos do backup.",
                  ],
                ] as const
              ).map(([valor, titulo, descricao]) => (
                <label
                  key={valor}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                    modo === valor ? "border-primary/60 bg-primary/5" : "hover:bg-muted/50"
                  } ${ocupado ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="modo-restauracao"
                    className="mt-1"
                    checked={modo === valor}
                    disabled={ocupado}
                    onChange={() => {
                      setModo(valor)
                      setResultado(null)
                    }}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{titulo}</span>
                    <span className="text-xs text-muted-foreground">{descricao}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Senhas e segredos de webhooks nunca fazem parte do backup. Usuários recriados ficam sem senha até alguém
              definir uma em Usuários, e os webhooks voltam sem o segredo.
            </p>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => void executar(true)} disabled={ocupado || semSecao}>
              <Search className="size-4" />
              Analisar sem gravar
            </Button>
            <Button onClick={() => void executar(false)} disabled={ocupado || semSecao}>
              {ocupado && andamento && !andamento.simulacao ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Restaurar agora
            </Button>
          </div>
        </>
      ) : null}

      {andamento ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm" aria-live="polite">
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" />
            {andamento.simulacao ? "Analisando o backup" : "Restaurando o backup"}
          </div>

          {etapa === "enviando" ? (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${percentualEnvio}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Enviando o arquivo… {percentualEnvio}%</span>
                <Button size="sm" variant="ghost" onClick={() => cancelarRef.current?.()}>
                  Cancelar envio
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full bg-primary transition-[width] ${andamento.total ? "" : "w-1/3 animate-pulse"}`}
                  style={andamento.total ? { width: `${percentualTabela}%` } : undefined}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {andamento.tabela
                  ? `${andamento.mensagem} ${andamento.tabela}: ${(andamento.feitas ?? 0).toLocaleString("pt-BR")} de ${(andamento.total ?? 0).toLocaleString("pt-BR")} · tabela ${Math.min((andamento.tabelasConcluidas ?? 0) + 1, andamento.totalTabelas ?? 1)} de ${andamento.totalTabelas}`
                  : andamento.mensagem}
              </p>
              {!andamento.simulacao ? (
                <p className="text-xs text-muted-foreground">
                  Pode demorar em arquivos grandes. Se fechar esta página, a restauração continua no servidor.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {erroExecucao ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{erroExecucao}</p>
        </div>
      ) : null}

      {resultado ? <Resultado resultado={resultado} /> : null}
    </div>
  )
}
