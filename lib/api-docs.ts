/**
 * Documentação detalhada de cada endpoint da API.
 *
 * Este registro é intencionalmente escrito à mão para carregar exemplos reais
 * de request/response, tipos de campos, headers de autenticação e comandos
 * `curl` prontos para copiar. A varredura em `lib/api-routes.ts` descobre as
 * rotas automaticamente; este arquivo enriquece cada método com detalhes.
 *
 * A chave do registro é `MÉTODO caminho` (ex.: "GET /api/leads/:id").
 */

export type FieldDoc = {
  nome: string
  tipo: string
  obrigatorio?: boolean
  descricao: string
}

export type ResponseDoc = {
  status: number
  descricao: string
  exemplo?: string
}

export type EndpointDoc = {
  /** Resumo curto de uma linha. */
  resumo: string
  /** Explicação completa do comportamento. */
  descricao: string
  /** Como a rota é autenticada. */
  auth: string
  /** Parâmetros no caminho da URL (segmentos dinâmicos). */
  pathParams?: FieldDoc[]
  /** Parâmetros de query string. */
  queryParams?: FieldDoc[]
  /** Headers relevantes. */
  headers?: FieldDoc[]
  /** Campos aceitos no corpo JSON. */
  bodyFields?: FieldDoc[]
  /** Corpo de exemplo (JSON). */
  requestExample?: string
  /** Respostas possíveis com exemplos. */
  responses: ResponseDoc[]
  /** Comando curl pronto para copiar (sem o host). */
  curl: string
}

/** Valores permitidos, reaproveitados nas descrições. */
export const ENUMS = {
  produto: ["Consórcio Imobiliário", "Consórcio de Veículos", "Seguro de Vida", "Financiamento", "Previdência"],
  marca: ["Ápice", "NovaVida", "Prisma", "Vértice"],
  persona: ["Investidor", "Primeira Casa", "Empresário", "Família", "Autônomo"],
  regiao: ["Sudeste", "Sul", "Centro-Oeste", "Nordeste", "Norte"],
  leadStatus: ["novo", "em_campanha", "respondeu", "qualificado", "encerrado"],
  campaignStatus: ["rascunho", "ativa", "pausada", "encerrada"],
  messageKind: ["enviada", "falha", "resposta", "agendada"],
} as const

const SESSAO =
  "Requer autenticação. Aceita o cookie de sessão `campanhas_session` (painel) ou o token estático `API_TOKEN` via header `Authorization: Bearer <token>` (ou `x-api-token`). Sem credencial válida, retorna 401."

export const API_DOCS: Record<string, EndpointDoc> = {
  // ---------------------------------------------------------------- LEADS
  "GET /api/leads": {
    resumo: "Lista todos os leads com agregações.",
    descricao:
      "Retorna a coleção completa de leads cadastrados, já com as contagens de mensagens e respostas calculadas a partir da timeline de eventos.",
    auth: SESSAO,
    responses: [
      {
        status: 200,
        descricao: "Lista de leads.",
        exemplo: `{
  "ok": true,
  "total": 2,
  "leads": [
    {
      "id": "lead_a1b2c3",
      "nome": "Marina Alves",
      "telefone": "(11) 98888-7777",
      "produto": "Consórcio Imobiliário",
      "marca": "Ápice",
      "persona": "Primeira Casa",
      "regiao": "Sudeste",
      "campanhaId": "camp_x9y8",
      "status": "em_campanha",
      "notas": null,
      "criadoEm": "2026-08-10T13:20:00.000Z",
      "entradaCampanhaEm": "2026-08-11T09:00:00.000Z"
    }
  ]
}`,
      },
      {
        status: 500,
        descricao: "Erro ao consultar o banco.",
        exemplo: `{ "ok": false, "erro": "Não foi possível listar os leads." }`,
      },
    ],
    curl: `curl -s "$BASE/api/leads" \\
  -H "Cookie: campanhas_session=SEU_TOKEN"`,
  },

  "POST /api/leads": {
    resumo: "Cria um novo lead.",
    descricao:
      "Exige apenas `nome` e `telefone`. Os campos de segmentação (produto/marca/persona/região) são opcionais e só validados quando enviados. Aceita também `notas`, uma anotação livre exibida nos detalhes do lead. Em caso de erro de validação, retorna 400 com um mapa `errors` por campo.",
    auth: SESSAO,
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome completo (mínimo 3 caracteres)." },
      { nome: "telefone", tipo: "string", obrigatorio: true, descricao: "Com DDD; mínimo 10 dígitos numéricos." },
      { nome: "produto", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.produto.join(", ")}.` },
      { nome: "marca", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.marca.join(", ")}.` },
      { nome: "persona", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.persona.join(", ")}.` },
      { nome: "regiao", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.regiao.join(", ")}.` },
      { nome: "notas", tipo: "string | null", descricao: "Opcional; anotação livre exibida nos detalhes do lead. Vazio ou null limpa o campo." },
      { nome: "status", tipo: "enum", descricao: `Opcional; padrão "novo". Um de: ${ENUMS.leadStatus.join(", ")}.` },
      { nome: "campanhasIds", tipo: "string[]", descricao: "Opcional; IDs de campanhas a vincular. A primeira vira a campanha principal." },
    ],
    requestExample: `{
  "nome": "Marina Alves",
  "telefone": "(11) 98888-7777",
  "notas": "Prefere contato à tarde."
}`,
    responses: [
      {
        status: 201,
        descricao: "Lead criado.",
        exemplo: `{
  "ok": true,
  "lead": {
    "id": "lead_a1b2c3",
    "nome": "Marina Alves",
    "status": "em_campanha",
    "campanhaId": "camp_x9y8",
    "criadoEm": "2026-08-14T16:05:00.000Z"
  }
}`,
      },
      {
        status: 400,
        descricao: "Validação falhou.",
        exemplo: `{
  "ok": false,
  "erro": "Corrija os campos destacados.",
  "errors": {
    "telefone": "Telefone precisa ter DDD e número.",
    "produto": "Selecione um produto válido."
  }
}`,
      },
    ],
    curl: `curl -s -X POST "$BASE/api/leads" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{
    "nome": "Marina Alves",
    "telefone": "(11) 98888-7777",
    "notas": "Prefere contato à tarde."
  }'`,
  },

  "GET /api/leads/:id": {
    resumo: "Detalha um lead e sua timeline.",
    descricao: "Retorna o lead e a lista cronológica de eventos (mensagens enviadas, respostas, qualificações, etc.).",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do lead, ex.: lead_a1b2c3." }],
    responses: [
      {
        status: 200,
        descricao: "Lead + timeline.",
        exemplo: `{
  "ok": true,
  "lead": { "id": "lead_a1b2c3", "nome": "Marina Alves", "status": "respondeu" },
  "timeline": [
    {
      "id": "evt_1",
      "tipo": "mensagem_enviada",
      "descricao": "Boas-vindas enviada",
      "data": "2026-08-11T09:00:00.000Z",
      "sucesso": true
    },
    {
      "id": "evt_2",
      "tipo": "resposta",
      "descricao": "Lead respondeu \\"Tenho interesse\\"",
      "data": "2026-08-11T10:12:00.000Z",
      "sucesso": true
    }
  ]
}`,
      },
      { status: 404, descricao: "Lead inexistente.", exemplo: `{ "ok": false, "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s "$BASE/api/leads/lead_a1b2c3" \\
  -H "Cookie: campanhas_session=SEU_TOKEN"`,
  },

  "PUT /api/leads/:id": {
    resumo: "Atualiza um lead.",
    descricao:
      "Exige apenas `nome` e `telefone`. Os demais campos são opcionais: só são alterados quando presentes no corpo, preservando os valores atuais quando omitidos. Aceita `notas` para gravar/limpar a anotação livre exibida nos detalhes. Retorna 404 se o lead não existir.",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do lead." }],
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome completo (mínimo 3 caracteres)." },
      { nome: "telefone", tipo: "string", obrigatorio: true, descricao: "Com DDD; mínimo 10 dígitos." },
      { nome: "produto", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.produto.join(", ")}.` },
      { nome: "marca", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.marca.join(", ")}.` },
      { nome: "persona", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.persona.join(", ")}.` },
      { nome: "regiao", tipo: "enum", descricao: `Opcional. Se enviado, um de: ${ENUMS.regiao.join(", ")}.` },
      { nome: "notas", tipo: "string | null", descricao: "Opcional; anotação livre exibida nos detalhes do lead. Vazio ou null limpa o campo." },
      { nome: "status", tipo: "enum", descricao: `Opcional; um de: ${ENUMS.leadStatus.join(", ")}.` },
      { nome: "campanhasIds", tipo: "string[]", descricao: "Opcional; IDs de campanhas vinculadas." },
    ],
    requestExample: `{
  "nome": "Marina Alves de Souza",
  "telefone": "(11) 98888-7777",
  "notas": "Retornar após feriado.",
  "status": "qualificado"
}`,
    responses: [
      { status: 200, descricao: "Lead atualizado.", exemplo: `{ "ok": true, "lead": { "id": "lead_a1b2c3", "status": "qualificado" } }` },
      { status: 404, descricao: "Lead inexistente.", exemplo: `{ "ok": false, "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s -X PUT "$BASE/api/leads/lead_a1b2c3" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{ "nome": "Marina Alves de Souza", "telefone": "(11) 98888-7777", "notas": "Retornar após feriado.", "status": "qualificado" }'`,
  },

  "DELETE /api/leads/:id": {
    resumo: "Remove um lead.",
    descricao: "Exclui o lead e todos os seus eventos em cascata. Retorna 404 se o lead não existir.",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do lead." }],
    responses: [
      { status: 200, descricao: "Removido.", exemplo: `{ "ok": true }` },
      { status: 404, descricao: "Lead inexistente.", exemplo: `{ "ok": false, "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s -X DELETE "$BASE/api/leads/lead_a1b2c3" \\
  -H "Cookie: campanhas_session=SEU_TOKEN"`,
  },

  // ------------------------------------------------------------ CAMPANHAS
  "GET /api/campanhas": {
    resumo: "Lista campanhas com estatísticas.",
    descricao: "Retorna todas as campanhas com métricas de desempenho agregadas (leads, mensagens, respostas).",
    auth: SESSAO,
    responses: [
      {
        status: 200,
        descricao: "Lista de campanhas.",
        exemplo: `{
  "total": 1,
  "campanhas": [
    {
      "id": "camp_x9y8",
      "nome": "Reativação Imóveis Q3",
      "status": "ativa",
      "recorrenciaDias": 7,
      "dataFinal": "2026-09-30",
      "filtros": { "produto": "Consórcio Imobiliário", "regiao": "Sudeste" },
      "mensagens": [
        { "id": "msg_1", "dia": 0, "horario": "09:00", "texto": "Olá {nome}!" }
      ]
    }
  ]
}`,
      },
      { status: 500, descricao: "Erro interno.", exemplo: `{ "erro": "Falha ao listar campanhas." }` },
    ],
    curl: `curl -s "$BASE/api/campanhas" \\
  -H "Cookie: campanhas_session=SEU_TOKEN"`,
  },

  "POST /api/campanhas": {
    resumo: "Cria uma campanha com sequência de mensagens.",
    descricao:
      "Cria uma campanha. Exige `nome`, `status` válido e `mensagens` como lista (pode ser vazia). Os demais campos assumem padrões quando omitidos.",
    auth: SESSAO,
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome da campanha." },
      { nome: "status", tipo: "enum", obrigatorio: true, descricao: `Um de: ${ENUMS.campaignStatus.join(", ")}.` },
      { nome: "mensagens", tipo: "CampaignMessage[]", obrigatorio: true, descricao: "Lista de mensagens { dia, horario, texto }. Pode ser [] mas o campo deve existir." },
      { nome: "descricao", tipo: "string", descricao: "Opcional; descrição livre." },
      { nome: "recorrenciaDias", tipo: "number", descricao: "Opcional; intervalo de recorrência em dias. Padrão 0." },
      { nome: "dataFinal", tipo: "string | null", descricao: "Opcional; data final (ISO ou YYYY-MM-DD)." },
      { nome: "filtros", tipo: "object", descricao: "Opcional; { produto, marca, persona, regiao } — cada um enum ou null." },
      { nome: "leadIds", tipo: "string[]", descricao: "Opcional; leads iniciais a vincular." },
    ],
    requestExample: `{
  "nome": "Reativação Imóveis Q3",
  "status": "rascunho",
  "descricao": "Sequência de 3 toques para leads frios",
  "recorrenciaDias": 7,
  "dataFinal": "2026-09-30",
  "filtros": { "produto": "Consórcio Imobiliário", "marca": null, "persona": null, "regiao": "Sudeste" },
  "leadIds": ["lead_a1b2c3"],
  "mensagens": [
    { "dia": 0, "horario": "09:00", "texto": "Olá {nome}, tudo bem?" },
    { "dia": 3, "horario": "14:00", "texto": "Passando para lembrar da nossa condição especial." }
  ]
}`,
    responses: [
      { status: 201, descricao: "Campanha criada.", exemplo: `{ "campanha": { "id": "camp_x9y8", "nome": "Reativação Imóveis Q3", "status": "rascunho" } }` },
      {
        status: 400,
        descricao: "Validação falhou.",
        exemplo: `{ "erro": "O campo 'status' deve ser um de: rascunho, ativa, pausada, encerrada." }`,
      },
    ],
    curl: `curl -s -X POST "$BASE/api/campanhas" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{
    "nome": "Reativação Imóveis Q3",
    "status": "rascunho",
    "mensagens": [ { "dia": 0, "horario": "09:00", "texto": "Olá {nome}!" } ]
  }'`,
  },

  "GET /api/campanhas/:id": {
    resumo: "Detalha uma campanha.",
    descricao: "Retorna uma campanha específica com suas estatísticas. 404 se não existir.",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID da campanha, ex.: camp_x9y8." }],
    responses: [
      { status: 200, descricao: "Campanha encontrada.", exemplo: `{ "campanha": { "id": "camp_x9y8", "nome": "Reativação Imóveis Q3", "status": "ativa" } }` },
      { status: 404, descricao: "Não encontrada.", exemplo: `{ "erro": "Campanha não encontrada." }` },
    ],
    curl: `curl -s "$BASE/api/campanhas/camp_x9y8" \\
  -H "Cookie: campanhas_session=SEU_TOKEN"`,
  },

  "PUT /api/campanhas/:id": {
    resumo: "Atualiza a campanha por completo.",
    descricao: "Substitui todos os campos da campanha. Mesmas regras do POST. 404 se não existir.",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID da campanha." }],
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome da campanha." },
      { nome: "status", tipo: "enum", obrigatorio: true, descricao: `Um de: ${ENUMS.campaignStatus.join(", ")}.` },
      { nome: "mensagens", tipo: "CampaignMessage[]", obrigatorio: true, descricao: "Lista de mensagens { dia, horario, texto }." },
      { nome: "descricao", tipo: "string", descricao: "Opcional." },
      { nome: "recorrenciaDias", tipo: "number", descricao: "Opcional; padrão 0." },
      { nome: "dataFinal", tipo: "string | null", descricao: "Opcional." },
      { nome: "filtros", tipo: "object", descricao: "Opcional; { produto, marca, persona, regiao }." },
      { nome: "leadIds", tipo: "string[]", descricao: "Opcional." },
    ],
    requestExample: `{
  "nome": "Reativação Imóveis Q3 (revisada)",
  "status": "ativa",
  "recorrenciaDias": 5,
  "dataFinal": "2026-10-15",
  "filtros": { "produto": "Consórcio Imobiliário", "marca": null, "persona": null, "regiao": null },
  "mensagens": [ { "dia": 0, "horario": "10:00", "texto": "Olá {nome}!" } ]
}`,
    responses: [
      { status: 200, descricao: "Atualizada.", exemplo: `{ "campanha": { "id": "camp_x9y8", "status": "ativa" } }` },
      { status: 404, descricao: "Não encontrada.", exemplo: `{ "erro": "Campanha não encontrada." }` },
    ],
    curl: `curl -s -X PUT "$BASE/api/campanhas/camp_x9y8" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{ "nome": "Reativação Imóveis Q3 (revisada)", "status": "ativa", "mensagens": [] }'`,
  },

  "PATCH /api/campanhas/:id": {
    resumo: "Altera apenas o status da campanha.",
    descricao: "Atalho para mudar somente o estado da campanha (ativar, pausar, encerrar) sem reenviar o objeto completo.",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID da campanha." }],
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [{ nome: "status", tipo: "enum", obrigatorio: true, descricao: `Um de: ${ENUMS.campaignStatus.join(", ")}.` }],
    requestExample: `{ "status": "pausada" }`,
    responses: [
      { status: 200, descricao: "Status alterado.", exemplo: `{ "campanha": { "id": "camp_x9y8", "status": "pausada" } }` },
      { status: 400, descricao: "Status inválido.", exemplo: `{ "erro": "O campo 'status' deve ser um de: rascunho, ativa, pausada, encerrada." }` },
      { status: 404, descricao: "Não encontrada.", exemplo: `{ "erro": "Campanha não encontrada." }` },
    ],
    curl: `curl -s -X PATCH "$BASE/api/campanhas/camp_x9y8" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{ "status": "pausada" }'`,
  },

  "DELETE /api/campanhas/:id": {
    resumo: "Remove a campanha.",
    descricao: "Exclui a campanha e seus vínculos com leads. Idempotente — sempre responde ok.",
    auth: SESSAO,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID da campanha." }],
    responses: [{ status: 200, descricao: "Removida.", exemplo: `{ "ok": true }` }],
    curl: `curl -s -X DELETE "$BASE/api/campanhas/camp_x9y8" \\
  -H "Cookie: campanhas_session=SEU_TOKEN"`,
  },

  // ------------------------------------------------------------ MENSAGENS
  "POST /api/mensagens": {
    resumo: "Registra um evento de mensagem.",
    descricao:
      "A engine de disparo reporta cada acontecimento de mensagem aqui. Grava o evento na timeline do lead e notifica os webhooks assinados. Exige `kind` válido e `leadId`.",
    auth: SESSAO,
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "kind", tipo: "enum", obrigatorio: true, descricao: `Tipo do evento. Um de: ${ENUMS.messageKind.join(", ")}.` },
      { nome: "leadId", tipo: "string", obrigatorio: true, descricao: "ID do lead relacionado." },
      { nome: "campanhaId", tipo: "string | null", descricao: "Opcional; campanha de origem." },
      { nome: "mensagemId", tipo: "string | null", descricao: "Opcional; mensagem da sequência." },
      { nome: "descricao", tipo: "string", descricao: "Opcional; texto descritivo do evento." },
      { nome: "detalhes", tipo: "string | null", descricao: "Opcional; detalhes extras (ex.: motivo da falha)." },
      { nome: "agendadoPara", tipo: "string | null", descricao: 'Opcional; ISO date quando kind = "agendada".' },
    ],
    requestExample: `{
  "kind": "resposta",
  "leadId": "lead_a1b2c3",
  "campanhaId": "camp_x9y8",
  "mensagemId": "msg_1",
  "descricao": "Lead respondeu 'Tenho interesse'"
}`,
    responses: [
      { status: 201, descricao: "Evento registrado.", exemplo: `{ "ok": true }` },
      { status: 400, descricao: "kind inválido ou leadId ausente.", exemplo: `{ "erro": "O campo 'kind' deve ser um de: enviada, falha, resposta, agendada." }` },
      { status: 404, descricao: "Lead não encontrado.", exemplo: `{ "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/mensagens" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{ "kind": "resposta", "leadId": "lead_a1b2c3", "descricao": "Lead respondeu" }'`,
  },

  // ---------------------------------------------------------------- CRON
  "GET /api/cron": {
    resumo: "Aciona a engine de disparo (leitura).",
    descricao:
      "Processa as mensagens agendadas que já venceram. Pensado para agendadores externos (cron-job.org, GitHub Actions, Vercel Cron). Quando `CRON_TOKEN` está definido, o token é exigido.",
    auth: "Público por padrão. Se `CRON_TOKEN` estiver definido, exige `x-cron-token: <token>` ou `?token=<token>`.",
    queryParams: [{ nome: "token", tipo: "string", descricao: "Token do cron quando CRON_TOKEN está definido." }],
    headers: [{ nome: "x-cron-token", tipo: "string", descricao: "Alternativa ao ?token= para autenticar o cron." }],
    responses: [
      { status: 200, descricao: "Processamento concluído.", exemplo: `{ "ok": true, "processados": 5, "enviados": 4, "falhas": 1 }` },
      { status: 401, descricao: "Token inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
    ],
    curl: `curl -s "$BASE/api/cron?token=SEU_CRON_TOKEN"`,
  },

  "POST /api/cron": {
    resumo: "Aciona a engine de disparo (escrita).",
    descricao: "Idêntico ao GET /api/cron — disponível como POST para agendadores que preferem esse método.",
    auth: "Público por padrão. Se `CRON_TOKEN` estiver definido, exige `x-cron-token: <token>` ou `?token=<token>`.",
    headers: [{ nome: "x-cron-token", tipo: "string", descricao: "Token do cron quando CRON_TOKEN está definido." }],
    responses: [
      { status: 200, descricao: "Processamento concluído.", exemplo: `{ "ok": true, "processados": 5, "enviados": 4, "falhas": 1 }` },
      { status: 401, descricao: "Token inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/cron" \\
  -H "x-cron-token: SEU_CRON_TOKEN"`,
  },

  // -------------------------------------------------------------- EVENTOS
  "POST /api/eventos": {
    resumo: "Ingestão de eventos de mensagem (externo).",
    descricao:
      "Endpoint de ingestão para a engine externa gravar eventos na timeline do lead. Idêntico em efeito ao POST /api/mensagens, mas protegido por token de ingestão em vez de sessão.",
    auth: "Se `INGEST_TOKEN` estiver definido, exige o header `x-ingest-token: <token>`. Sem a env definida, aceita sem token.",
    headers: [
      { nome: "x-ingest-token", tipo: "string", descricao: "Token de ingestão quando INGEST_TOKEN está definido." },
      { nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" },
    ],
    bodyFields: [
      { nome: "kind", tipo: "enum", obrigatorio: true, descricao: `Um de: ${ENUMS.messageKind.join(", ")}.` },
      { nome: "leadId", tipo: "string", obrigatorio: true, descricao: "ID do lead." },
      { nome: "campanhaId", tipo: "string | null", descricao: "Opcional." },
      { nome: "mensagemId", tipo: "string | null", descricao: "Opcional." },
      { nome: "descricao", tipo: "string", descricao: "Opcional." },
      { nome: "detalhes", tipo: "string | null", descricao: "Opcional." },
      { nome: "agendadoPara", tipo: "string | null", descricao: "Opcional; ISO date." },
    ],
    requestExample: `{
  "kind": "enviada",
  "leadId": "lead_a1b2c3",
  "campanhaId": "camp_x9y8",
  "mensagemId": "msg_1",
  "descricao": "Mensagem de boas-vindas enviada"
}`,
    responses: [
      { status: 200, descricao: "Evento registrado.", exemplo: `{ "ok": true }` },
      { status: 400, descricao: "kind inválido ou leadId ausente.", exemplo: `{ "ok": false, "erro": "kind deve ser um de: enviada, falha, resposta, agendada." }` },
      { status: 401, descricao: "Token de ingestão inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
      { status: 404, descricao: "Lead não encontrado.", exemplo: `{ "ok": false, "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/eventos" \\
  -H "Content-Type: application/json" \\
  -H "x-ingest-token: SEU_INGEST_TOKEN" \\
  -d '{ "kind": "enviada", "leadId": "lead_a1b2c3", "descricao": "Mensagem enviada" }'`,
  },

  // -------------------------------------------------------------- WEBHOOK
  "POST /api/webhook/entrada": {
    resumo: "Recebe eventos de sistemas externos.",
    descricao:
      "Endpoint público para sistemas de terceiros dispararem eventos para dentro do sistema. Autenticado pelo token do webhook gerado no painel. Registra o IP de origem para auditoria.",
    auth: "Exige o header `x-webhook-token: <token>` gerado no painel. Token inválido ou webhook desativado retorna 401.",
    headers: [
      { nome: "x-webhook-token", tipo: "string", obrigatorio: true, descricao: "Token do webhook gerado no painel." },
      { nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" },
    ],
    bodyFields: [
      { nome: "evento", tipo: "string", obrigatorio: true, descricao: "Nome do evento, ex.: lead.novo, pagamento.aprovado." },
      { nome: "dados", tipo: "object", descricao: "Opcional; payload livre do sistema externo." },
    ],
    requestExample: `{
  "evento": "lead.novo",
  "dados": {
    "nome": "João Pereira",
    "telefone": "(21) 97777-1234",
    "origem": "site"
  }
}`,
    responses: [
      { status: 200, descricao: "Evento aceito.", exemplo: `{ "ok": true, "mensagem": "Evento recebido." }` },
      { status: 400, descricao: 'Campo "evento" ausente.', exemplo: `{ "ok": false, "erro": "Campo \\"evento\\" é obrigatório." }` },
      { status: 401, descricao: "Token ausente/inválido ou webhook desativado.", exemplo: `{ "ok": false, "erro": "Token inválido ou webhook desativado." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/webhook/entrada" \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-token: SEU_WEBHOOK_TOKEN" \\
  -d '{ "evento": "lead.novo", "dados": { "nome": "João Pereira" } }'`,
  },
}

/** Retorna a doc de um método/rota, se existir. */
export function getEndpointDoc(method: string, urlPath: string): EndpointDoc | null {
  return API_DOCS[`${method} ${urlPath}`] ?? null
}
