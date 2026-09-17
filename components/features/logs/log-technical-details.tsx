"use client"

import Link from "next/link"
import { useState } from "react"
import { Check, Code2, Copy, MapPin } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDateTime } from "@/lib/format"
import type { AppLogNivel } from "@/services/app-logs"

// ---------------------------------------------------------------------------
// Tradução de erros técnicos comuns para uma explicação em linguagem simples.
// Isso NÃO altera o que é gravado no log — é só uma camada de leitura para
// ajudar o usuário não programador a entender a causa provável, sem esconder
// o erro original (que continua disponível em "Ver detalhes técnicos").
// ---------------------------------------------------------------------------

const PADROES_CONHECIDOS: Array<{ teste: RegExp; explicacao: string }> = [
  {
    teste: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed/i,
    explicacao:
      "Não foi possível conectar a um serviço externo. Provavelmente uma instabilidade temporária de rede ou o serviço estava fora do ar.",
  },
  {
    teste: /timeout|ETIMEDOUT/i,
    explicacao: "A operação demorou mais que o esperado e foi cancelada.",
  },
  {
    teste: /Unique constraint|P2002/,
    explicacao: "Já existe um registro com essas mesmas informações (duplicado).",
  },
  {
    teste: /Foreign key constraint|P2003/,
    explicacao:
      "A ação foi bloqueada porque depende de outro registro que não existe ou não pode ser removido.",
  },
  {
    teste: /Record to update not found|Record to delete does not exist|P2025/,
    explicacao: "O registro que essa ação tentou alterar não foi encontrado — ele pode já ter sido excluído.",
  },
  {
    teste: /\b401\b|Unauthorized/i,
    explicacao: "Falha de autenticação com um serviço externo (credenciais inválidas ou expiradas).",
  },
  {
    teste: /\b403\b|Forbidden/i,
    explicacao: "Acesso negado por um serviço externo.",
  },
  {
    teste: /\b404\b|Not Found/i,
    explicacao: "Um recurso esperado não foi encontrado em um serviço externo.",
  },
  {
    teste: /\b429\b|Too Many Requests|rate limit/i,
    explicacao: "O limite de requisições de um serviço externo foi atingido. Tende a se resolver sozinho em instantes.",
  },
  {
    teste: /5\d\d|Internal Server Error/,
    explicacao: "Um serviço externo (ex.: gateway de WhatsApp) apresentou instabilidade no momento.",
  },
]

function explicarErro(detalhes: string | null): string | null {
  if (!detalhes) return null
  const encontrado = PADROES_CONHECIDOS.find((p) => p.teste.test(detalhes))
  return encontrado?.explicacao ?? null
}

// ---------------------------------------------------------------------------
// `detalhes` pode conter, no início, blocos "Local: ..." e "Contexto: {...}"
// gravados automaticamente por `recordAppLog` (ver services/app-logs.ts),
// separados por linha em branco do texto original (mensagem de erro/stack).
// O parsing é tolerante: logs antigos, sem esses blocos, continuam sendo
// exibidos por completo como "conteúdo original", sem nada quebrar.
// ---------------------------------------------------------------------------

interface DetalhesEstruturados {
  localizacao: string | null
  contexto: Record<string, string> | null
  original: string | null
}

function parseDetalhes(raw: string): DetalhesEstruturados {
  const blocos = raw.split("\n\n")
  let indice = 0
  let localizacao: string | null = null
  let contexto: Record<string, string> | null = null

  if (blocos[indice]?.startsWith("Local: ")) {
    localizacao = blocos[indice].slice("Local: ".length).trim()
    indice += 1
  }
  if (blocos[indice]?.startsWith("Contexto: ")) {
    try {
      contexto = JSON.parse(blocos[indice].slice("Contexto: ".length).trim())
    } catch {
      contexto = null
    }
    // Só avança se o parse deu certo — um bloco que só PARECE um contexto
    // (JSON malformado) fica no conteúdo original em vez de ser descartado.
    if (contexto) indice += 1
  }

  const original = blocos.slice(indice).join("\n\n").trim() || null
  return { localizacao, contexto, original }
}

/** Rótulos amigáveis para as chaves de contexto mais comuns. */
const CONTEXTO_LABELS: Record<string, string> = {
  etapa: "Etapa",
  leadId: "Lead",
  leadNome: "Lead",
  campanhaId: "Campanha",
  campanhaNome: "Campanha",
  mensagemId: "Mensagem",
  instanciaNome: "Instância",
  telefone: "Telefone",
  statusHttp: "Status HTTP",
  endpoint: "Endpoint",
  tentativas: "Tentativas",
  dia: "Dia da sequência",
}

function labelContexto(chave: string): string {
  return CONTEXTO_LABELS[chave] ?? chave
}

/** Alguns campos de contexto viram link direto para a página do registro. */
function linkContexto(chave: string, valor: string): string | null {
  if (chave === "leadId") return `/leads/${valor}`
  if (chave === "campanhaId") return `/campanhas/${valor}`
  return null
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface LogTechnicalDetailsProps {
  nivel: AppLogNivel
  origem: string
  mensagem: string
  detalhes: string | null
  data: string
}

const NIVEL_LABEL: Record<AppLogNivel, string> = {
  info: "Info",
  aviso: "Aviso",
  erro: "Erro",
  critico: "Crítico",
}

export function LogTechnicalDetails({ nivel, origem, mensagem, detalhes, data }: LogTechnicalDetailsProps) {
  const [copiado, setCopiado] = useState(false)
  const estruturado = detalhes ? parseDetalhes(detalhes) : null
  const explicacao = explicarErro(estruturado?.original ?? detalhes)

  async function copiar() {
    if (!detalhes) return
    try {
      await navigator.clipboard.writeText(detalhes)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sem permissão de clipboard — ignora silenciosamente.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">{mensagem}</span>
      {explicacao && (
        <span className="text-xs text-muted-foreground">{explicacao}</span>
      )}
      {detalhes && (
        <Dialog>
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-fit gap-1 px-1.5 text-xs text-muted-foreground"
              >
                <Code2 className="size-3" />
                Ver detalhes técnicos
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Detalhes técnicos do erro</DialogTitle>
              <DialogDescription>
                Informação original registrada pelo sistema, útil para quem for investigar o problema.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{NIVEL_LABEL[nivel] ?? nivel}</Badge>
              <span className="font-mono">{origem}</span>
              <span>•</span>
              <span>{formatDateTime(data)}</span>
            </div>

            {estruturado?.localizacao && (
              <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 p-2 text-xs">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">Onde ocorreu</span>
                  <span className="font-mono break-all text-muted-foreground">{estruturado.localizacao}</span>
                </div>
              </div>
            )}

            {estruturado?.contexto && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs">
                <span className="font-medium text-foreground">Contexto</span>
                <dl className="mt-1 flex flex-col gap-1">
                  {Object.entries(estruturado.contexto).map(([chave, valor]) => {
                    const href = linkContexto(chave, valor)
                    return (
                      <div key={chave} className="flex gap-2">
                        <dt className="w-28 shrink-0 text-muted-foreground">{labelContexto(chave)}</dt>
                        <dd className="break-all font-mono text-foreground">
                          {href ? (
                            <Link href={href} className="underline hover:text-primary">
                              {valor}
                            </Link>
                          ) : (
                            valor
                          )}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </div>
            )}

            {(estruturado ? estruturado.original : detalhes) && (
              <ScrollArea className="max-h-72 rounded-md border bg-muted/40">
                <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs text-foreground">
                  {estruturado ? estruturado.original : detalhes}
                </pre>
              </ScrollArea>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={copiar} className="gap-1.5">
                {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}