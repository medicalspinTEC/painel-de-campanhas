"use client"

import { useState } from "react"
import { Check, Code2, Copy } from "lucide-react"

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
  const explicacao = explicarErro(detalhes)

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

            <ScrollArea className="max-h-72 rounded-md border bg-muted/40">
              <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs text-foreground">
                {detalhes}
              </pre>
            </ScrollArea>

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