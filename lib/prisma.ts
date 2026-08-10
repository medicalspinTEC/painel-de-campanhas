import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "@/lib/generated/prisma/client"

/**
 * Indica se há uma connection string configurada. As páginas usam isso para
 * mostrar instruções de setup em vez de estourar um erro de conexão.
 */
export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL)
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma: { cliente: PrismaClient; url: string | undefined } | undefined
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // O driver `pg` não tem timeout por padrão; sem isto uma instância
    // indisponível deixaria a requisição pendurada indefinidamente.
    connectionTimeoutMillis: 10_000,
    /*
     * O pool default do `pg` é de 10 conexões por processo. Em serverless cada
     * instância mantém o seu, então vários processos simultâneos estouram o
     * limite do Postgres ("too many clients"). Um pool pequeno com reciclagem
     * de conexões ociosas escala melhor nesse modelo.
     */
    max: 5,
    idleTimeoutMillis: 10_000,
  })
  return new PrismaClient({ adapter })
}

/**
 * Devolve a instância única do Prisma Client, criando-a apenas no primeiro uso.
 *
 * O cliente é guardado em `globalThis` para que o hot reload não abra um novo
 * pool a cada recompilação, o que esgotaria as conexões do Postgres em
 * desenvolvimento. Junto dele guardamos a URL usada na criação: se ela mudar
 * (caso típico de conectar o banco com o servidor já rodando), o pool antigo é
 * descartado. Sem isso, um cliente criado sem `DATABASE_URL` ficaria preso no
 * host default do driver `pg` e seguiria falhando mesmo após a configuração.
 */
function getPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL
  const cache = globalThis.__prisma
  // Valida o formato: um hot reload pode ter deixado um cache de versão
  // anterior deste módulo, com outra estrutura, em `globalThis`.
  const cacheValido = cache?.cliente instanceof PrismaClient

  if (cacheValido && cache.url === url) return cache.cliente

  // Encerra o pool anterior sem bloquear: a URL mudou e ele não serve mais.
  if (cacheValido) void cache.cliente.$disconnect().catch(() => {})

  const cliente = createPrismaClient()
  globalThis.__prisma = { cliente, url }
  return cliente
}

/**
 * Proxy que resolve o cliente sob demanda. Assim o módulo pode ser importado
 * mesmo sem banco configurado — o pool só é aberto quando uma query acontece.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_alvo, propriedade, receptor) {
    const cliente = getPrismaClient()
    const valor = Reflect.get(cliente, propriedade, receptor)
    return typeof valor === "function" ? valor.bind(cliente) : valor
  },
})
