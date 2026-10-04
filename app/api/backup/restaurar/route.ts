import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

import { isModoRestauracao, LIMITE_ARQUIVO_BYTES, type EventoRestauracao } from "@/lib/backup/formato"
import { normalizarSecoes } from "@/lib/backup/secoes"
import { getCurrentUser, guardApi } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import { prepararRestauracao, RestauracaoError } from "@/services/restore"

/**
 * Restaura os dados a partir de um arquivo de backup (.json gerado por "Baixar backup").
 *
 * POST /api/backup/restaurar?secoes=leads,campanhas&modo=mesclar&simular=1
 * Corpo: o próprio arquivo (application/json), enviado sem multipart para ser lido em fluxo.
 *
 * - `secoes`: chaves de `lib/backup/secoes.ts` (obrigatório).
 * - `modo`: `mesclar` (padrão, só adiciona o que falta) ou `sobrescrever`.
 * - `simular`: `1` só analisa e conta, sem gravar nada.
 *
 * Resposta:
 * - Erro antes de começar (arquivo inválido, sem permissão, já há restauração
 *   em andamento): JSON `{ ok: false, erro }` com status 4xx.
 * - Caso contrário: NDJSON (uma linha por evento: `fase`, `progresso`, `fim`
 *   ou `erro`; ver `EventoRestauracao`), para a tela acompanhar o andamento.
 *
 * Esta rota fica fora do `proxy.ts` (ver o matcher): o proxy limita o corpo a
 * ~10 MB e cortaria o arquivo. O acesso é conferido aqui, com `guardApi`.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Mesmo acesso de "Baixar backup" (página de Configurações). */
const SECAO_ACESSO = "configuracoes"
/** Seções que só o root pode restaurar: criar/alterar usuários muda níveis e permissões. */
const SECOES_SO_ROOT = ["usuarios"]

function erroJson(erro: string, status: number) {
  return NextResponse.json({ ok: false, erro }, { status })
}

export async function POST(request: Request) {
  const negado = await guardApi(SECAO_ACESSO)
  if (negado) return negado

  const params = new URL(request.url).searchParams
  const secoes = normalizarSecoes((params.get("secoes") ?? "").split(",").filter(Boolean))
  if (!secoes.length) return erroJson("Selecione ao menos uma seção para restaurar.", 400)

  const modo = params.get("modo") ?? "mesclar"
  if (!isModoRestauracao(modo)) return erroJson("Modo de restauração inválido.", 400)
  const simular = params.get("simular") === "1" || params.get("simular") === "true"

  // Sessão de navegador (null quando a chamada usa só o API_TOKEN).
  const usuario = await getCurrentUser()
  if (usuario && usuario.role !== "root") {
    const restritas = secoes.filter((s) => SECOES_SO_ROOT.includes(s))
    if (restritas.length) {
      return erroJson("Só o usuário root pode restaurar a seção de Usuários.", 403)
    }
  }

  if (!request.body) return erroJson("Envie o arquivo de backup no corpo da requisição.", 400)
  const tamanho = Number(request.headers.get("content-length") ?? 0)
  if (tamanho > LIMITE_ARQUIVO_BYTES) {
    return erroJson(`O arquivo passa de ${Math.round(LIMITE_ARQUIVO_BYTES / (1024 * 1024))} MB, que é o limite aceito.`, 413)
  }

  // Lê o arquivo inteiro (em fluxo, indo para disco) e valida antes de gravar qualquer coisa.
  let preparada: Awaited<ReturnType<typeof prepararRestauracao>>
  try {
    preparada = await prepararRestauracao(request.body, {
      secoes,
      modo,
      simular,
      usuarioId: usuario?.id ?? "",
      usuarioNome: usuario?.nome ?? "API_TOKEN",
    })
  } catch (error) {
    if (error instanceof RestauracaoError) return erroJson(error.message, 400)
    // Cliente desistiu do envio: não há ninguém para responder nem o que registrar.
    if (request.signal.aborted) return new Response(null, { status: 499 })
    await recordAppLog({ origem: "backup", mensagem: "Não foi possível ler o arquivo de backup para restaurar.", detalhes: error })
    return erroJson("Não foi possível ler o arquivo de backup.", 500)
  }

  const codificador = new TextEncoder()
  let aberto = true

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (evento: EventoRestauracao) => {
        if (!aberto) return
        try {
          controller.enqueue(codificador.encode(`${JSON.stringify(evento)}\n`))
        } catch {
          aberto = false
        }
      }

      try {
        enviar({ tipo: "fase", mensagem: "Arquivo recebido e validado." })
        // Se o cliente fechar a aba daqui em diante, a restauração continua até o fim (é idempotente).
        const resultado = await preparada.executar(enviar)
        if (!simular) {
          try {
            revalidatePath("/", "layout")
          } catch {
            // Só limpa o cache das telas; a restauração já foi gravada.
          }
        }
        enviar({ tipo: "fim", resultado })
      } catch (error) {
        console.error("[v0] POST /api/backup/restaurar falhou:", error)
        enviar({
          tipo: "erro",
          mensagem:
            error instanceof RestauracaoError
              ? error.message
              : "A restauração falhou. Veja os detalhes em Logs (origem: backup). O que já foi gravado foi mantido.",
        })
      } finally {
        try {
          controller.close()
        } catch {
          // Já fechado pelo cliente.
        }
      }
    },
    cancel() {
      aberto = false
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Evita que um proxy reverso (nginx) acumule as linhas e a tela só veja o progresso no fim.
      "x-accel-buffering": "no",
    },
  })
}
