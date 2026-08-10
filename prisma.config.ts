import "dotenv/config"
import { defineConfig } from "prisma/config"

/**
 * Configuração da CLI do Prisma (migrations, generate, studio).
 * No Prisma 7 a connection string vive aqui, não no bloco `datasource`.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    /*
     * Deliberadamente não usamos o helper `env()`: ele lança se a variável não
     * existir, o que impediria `prisma generate` de rodar (e portanto o
     * type-check do projeto) antes de o banco estar conectado.
     * Comandos que tocam o banco, como `migrate`, seguem exigindo a URL real.
     */
    url: process.env.DATABASE_URL ?? "",
  },
})
