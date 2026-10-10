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
  leadStatus: ["novo", "em_campanha", "sem_campanha", "respondeu", "encerrado"],
  campaignStatus: ["rascunho", "ativa", "pausada", "encerrada"],
  campaignTipo: ["padrao", "individual"],
  messageKind: ["enviada", "falha", "resposta", "agendada"],
} as const

/**
 * Autenticação das rotas de painel: cookie de sessão OU `API_TOKEN` (acesso total). Com sessão, o
 * usuário precisa ter acesso a pelo menos uma das seções da rota (`guardApi`), e a seção precisa
 * estar disponível na instância (plugin ativo).
 */
function sessao(...secoes: string[]): string {
  return `Requer autenticação: cookie de sessão \`campanhas_session\` (painel) ou o token estático \`API_TOKEN\` via \`Authorization: Bearer <token>\` (ou header \`x-api-token\`), que tem acesso total. Com sessão, o usuário precisa ter acesso a uma das seções: ${secoes.join(", ")}. Sem credencial: 401. Sem permissão ou com a seção indisponível: 403.`
}

const SESSAO_LEADS = sessao("leads", "campanhas", "kanban", "chat")
const SESSAO_CAMPANHAS = sessao("campanhas")
const SESSAO_MENSAGENS = sessao("chat", "leads", "campanhas")
const SESSAO_CONFIG = sessao("configuracoes")

/** Telefone: sempre com o código do país (55) na frente. */
const TELEFONE_DESC =
  "Com código do país: 55 + DDD + número (12 ou 13 dígitos; a formatação é ignorada e só os dígitos são gravados). Ex.: 5551999999999. Sem o 55 retorna 400."
const SEGMENTACAO_DESC = (campo: string) =>
  `Opcional; texto livre (${campo} cadastrada(o) na aba Segmentação). Não há lista fixa para validar.`

export const API_DOCS: Record<string, EndpointDoc> = {
  // ---------------------------------------------------------------- LEADS
  "GET /api/leads": {
    resumo: "Lista todos os leads com agregações.",
    descricao:
      "Retorna a coleção completa de leads cadastrados, já com as contagens de mensagens e respostas calculadas a partir da timeline de eventos.",
    auth: SESSAO_LEADS,
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
      "telefone": "5511988887777",
      "produto": "Consórcio Imobiliário",
      "marca": "Ápice",
      "persona": "Primeira Casa",
      "regiao": "Sudeste",
      "campanhaId": "camp_x9y8",
      "status": "em_campanha",
      "notas": null,
      "negocio": null,
      "atividade": null,
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
      "Exige `nome` (mínimo 3 caracteres) e `telefone` com o código do país 55. Os campos de segmentação (produto/marca/persona/região) são texto livre e opcionais. Aceita também `notas`, uma anotação livre exibida nos detalhes do lead. Formato inválido retorna 400 com um mapa `errors` por campo; nome ou telefone que já pertencem a outro lead retornam 409 com o mesmo formato.",
    auth: SESSAO_LEADS,
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome completo (mínimo 3 caracteres)." },
      { nome: "telefone", tipo: "string", obrigatorio: true, descricao: TELEFONE_DESC },
      { nome: "produto", tipo: "string", descricao: SEGMENTACAO_DESC("produto") },
      { nome: "marca", tipo: "string", descricao: SEGMENTACAO_DESC("marca") },
      { nome: "persona", tipo: "string", descricao: SEGMENTACAO_DESC("persona") },
      { nome: "regiao", tipo: "string", descricao: SEGMENTACAO_DESC("região") },
      { nome: "notas", tipo: "string | null", descricao: "Opcional; anotação livre exibida nos detalhes do lead. Vazio ou null limpa o campo." },
      { nome: "status", tipo: "enum", descricao: `Opcional; padrão "novo". Um de: ${ENUMS.leadStatus.join(", ")}.` },
      { nome: "campanhasIds", tipo: "string[]", descricao: "Opcional; IDs de campanhas a vincular. A primeira vira a campanha principal." },
    ],
    requestExample: `{
  "nome": "Marina Alves",
  "telefone": "5511988887777",
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
    "telefone": "Inclua o código do país 55 antes do DDD (ex.: 5551999999999)."
  }
}`,
      },
      {
        status: 409,
        descricao: "Nome ou telefone já cadastrados em outro lead.",
        exemplo: `{
  "ok": false,
  "erro": "Corrija os campos destacados.",
  "errors": { "telefone": "Já existe um lead com este telefone." }
}`,
      },
      { status: 500, descricao: "Erro ao gravar.", exemplo: `{ "ok": false, "erro": "Não foi possível criar o lead." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/leads" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{
    "nome": "Marina Alves",
    "telefone": "5511988887777",
    "notas": "Prefere contato à tarde."
  }'`,
  },

  "GET /api/leads/:id": {
    resumo: "Detalha um lead e sua timeline.",
    descricao: "Retorna o lead e a lista cronológica de eventos (mensagens enviadas, respostas, etc.).",
    auth: SESSAO_LEADS,
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
      "Exige `nome` e `telefone` (com o código do país 55). Os campos de segmentação e `notas` são opcionais: só são alterados quando presentes no corpo, preservando os valores atuais quando omitidos (`notas` vazio ou null limpa a anotação). `status` e `campanhasIds` sempre são aplicados: sem `status` o lead volta para \"novo\" e sem `campanhasIds` ele fica sem campanha principal (vincular a uma campanha também marca o lead como \"em_campanha\"). Formato inválido: 400. Nome ou telefone iguais aos de outro lead: 409. Lead inexistente: 404.",
    auth: SESSAO_LEADS,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do lead." }],
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome completo (mínimo 3 caracteres)." },
      { nome: "telefone", tipo: "string", obrigatorio: true, descricao: TELEFONE_DESC },
      { nome: "produto", tipo: "string", descricao: SEGMENTACAO_DESC("produto") },
      { nome: "marca", tipo: "string", descricao: SEGMENTACAO_DESC("marca") },
      { nome: "persona", tipo: "string", descricao: SEGMENTACAO_DESC("persona") },
      { nome: "regiao", tipo: "string", descricao: SEGMENTACAO_DESC("região") },
      { nome: "notas", tipo: "string | null", descricao: "Opcional; anotação livre exibida nos detalhes do lead. Vazio ou null limpa o campo." },
      { nome: "status", tipo: "enum", descricao: `Opcional; um de: ${ENUMS.leadStatus.join(", ")}.` },
      { nome: "campanhasIds", tipo: "string[]", descricao: "Opcional; IDs de campanhas vinculadas." },
    ],
    requestExample: `{
  "nome": "Marina Alves de Souza",
  "telefone": "5511988887777",
  "notas": "Retornar após feriado.",
  "status": "respondeu"
}`,
    responses: [
      { status: 200, descricao: "Lead atualizado.", exemplo: `{ "ok": true, "lead": { "id": "lead_a1b2c3", "status": "respondeu" } }` },
      {
        status: 400,
        descricao: "Validação falhou (nome curto ou telefone sem o 55).",
        exemplo: `{ "ok": false, "erro": "Corrija os campos destacados.", "errors": { "telefone": "Inclua o código do país 55 antes do DDD (ex.: 5551999999999)." } }`,
      },
      { status: 409, descricao: "Nome ou telefone iguais aos de outro lead.", exemplo: `{ "ok": false, "erro": "Corrija os campos destacados.", "errors": { "telefone": "Já existe um lead com este telefone." } }` },
      { status: 404, descricao: "Lead inexistente.", exemplo: `{ "ok": false, "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s -X PUT "$BASE/api/leads/lead_a1b2c3" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{ "nome": "Marina Alves de Souza", "telefone": "5511988887777", "notas": "Retornar após feriado.", "status": "respondeu" }'`,
  },

  "DELETE /api/leads/:id": {
    resumo: "Remove um lead.",
    descricao: "Exclui o lead e todos os seus eventos em cascata. Retorna 404 se o lead não existir.",
    auth: SESSAO_LEADS,
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
    descricao:
      "Retorna todas as campanhas com métricas de desempenho agregadas (leads, mensagens, respostas). Cada mensagem da sequência traz `anexo` (referência do arquivo anexado — id, tipo, mime, nome e tamanho) ou `null`; o conteúdo do arquivo nunca é devolvido pela API.",
    auth: SESSAO_CAMPANHAS,
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
        {
          "id": "msg_1", "dia": 0, "horario": "09:00", "texto": "Olá {{primeiro_nome}}!",
          "anexo": { "id": "3f2b8c1e-5d4a-4b6e-9f10-2a7c8d9e0b11", "tipo": "imagem", "mime": "image/jpeg", "nome": "tabela.jpg", "tamanho": 183204 }
        }
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
      "Cria uma campanha. Exige `nome`, `status` válido e `mensagens` como lista (pode ser vazia). `tipo` define o modelo: `padrao` (sequência de `mensagens` para todos os leads do público) ou `individual` (um texto por lead em `leadMensagens`; `mensagens` é ignorada e o público é só o de `leadIds`). Em mensagens com `anexo`, a referência só é aceita se o arquivo estiver livre (upload feito pelo painel) — a API não recebe arquivos; uma referência inválida, de arquivo inexistente ou de outra mensagem é descartada. Os demais campos assumem padrões quando omitidos.",
    auth: SESSAO_CAMPANHAS,
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome da campanha." },
      { nome: "status", tipo: "enum", obrigatorio: true, descricao: `Um de: ${ENUMS.campaignStatus.join(", ")}.` },
      { nome: "mensagens", tipo: "CampaignMessage[]", obrigatorio: true, descricao: "Lista de mensagens { dia, horario, texto, anexo? }. Pode ser [] mas o campo deve existir. Textos aceitam {{primeiro_nome}} e {{nome}}. Com `anexo`, o texto vira a legenda do arquivo." },
      { nome: "tipo", tipo: "enum", descricao: `Opcional; padrão "padrao". Um de: ${ENUMS.campaignTipo.join(", ")}. Não muda depois da criação.` },
      { nome: "leadMensagens", tipo: "object", descricao: 'Opcional; só para tipo "individual": { "<leadId>": "texto do lead" }.' },
      { nome: "instanciaNome", tipo: "string | null", descricao: "Opcional; instância da Evolution que envia. Vazio = a instância mais recente." },
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
    { "dia": 0, "horario": "09:00", "texto": "Olá {{primeiro_nome}}, tudo bem?" },
    { "dia": 3, "horario": "14:00", "texto": "Passando para lembrar da nossa condição especial." }
  ]
}`,
    responses: [
      { status: 201, descricao: "Campanha criada.", exemplo: `{ "campanha": { "id": "camp_x9y8", "nome": "Reativação Imóveis Q3", "status": "rascunho" } }` },
      {
        status: 400,
        descricao: "Validação falhou (nome, status, mensagens, tipo ou leadMensagens).",
        exemplo: `{ "erro": "O campo 'status' deve ser um de: rascunho, ativa, pausada, encerrada." }`,
      },
      { status: 500, descricao: "Erro ao gravar.", exemplo: `{ "erro": "Falha ao criar campanha." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/campanhas" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -d '{
    "nome": "Reativação Imóveis Q3",
    "status": "rascunho",
    "mensagens": [ { "dia": 0, "horario": "09:00", "texto": "Olá {{primeiro_nome}}!" } ]
  }'`,
  },

  "GET /api/campanhas/:id": {
    resumo: "Detalha uma campanha.",
    descricao: "Retorna uma campanha específica com suas estatísticas. 404 se não existir.",
    auth: SESSAO_CAMPANHAS,
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
    descricao:
      "Substitui os campos da campanha; mesmas validações do POST. O `tipo` não muda: vale o da campanha. `instanciaNome` omitido mantém a instância atual. Sequência de mensagens: as com `id` são atualizadas (o histórico continua apontando para elas), as sem `id` são criadas e as que não vierem na lista são removidas — junto com o arquivo anexado. Em cada mensagem, `anexo` omitido mantém o anexo atual, `null` remove (e apaga o arquivo) e um objeto troca por um arquivo livre. Para campanhas individuais reenvie `leadIds` (a lista substitui os leads vinculados) e, se for mudar textos, `leadMensagens`. 404 se não existir.",
    auth: SESSAO_CAMPANHAS,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID da campanha." }],
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "nome", tipo: "string", obrigatorio: true, descricao: "Nome da campanha." },
      { nome: "status", tipo: "enum", obrigatorio: true, descricao: `Um de: ${ENUMS.campaignStatus.join(", ")}.` },
      { nome: "mensagens", tipo: "CampaignMessage[]", obrigatorio: true, descricao: "Lista de mensagens { id?, dia, horario, texto, anexo? }. `id` de mensagem de outra campanha é ignorado (vira mensagem nova)." },
      { nome: "instanciaNome", tipo: "string | null", descricao: "Opcional; omitido mantém a instância atual, null volta para a mais recente." },
      { nome: "leadMensagens", tipo: "object", descricao: 'Opcional; só campanhas "individual": { "<leadId>": "texto" }.' },
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
  "mensagens": [ { "dia": 0, "horario": "10:00", "texto": "Olá {{primeiro_nome}}!" } ]
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
    auth: SESSAO_CAMPANHAS,
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
    descricao:
      "Exclui a campanha, seus vínculos com leads e, na hora, os arquivos (imagens, vídeos, documentos) anexados às mensagens dela no servidor. Idempotente — sempre responde ok.",
    auth: SESSAO_CAMPANHAS,
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
    auth: SESSAO_MENSAGENS,
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" }],
    bodyFields: [
      { nome: "kind", tipo: "enum", obrigatorio: true, descricao: `Tipo do evento. Um de: ${ENUMS.messageKind.join(", ")}.` },
      { nome: "leadId", tipo: "string", obrigatorio: true, descricao: "ID do lead relacionado." },
      { nome: "campanhaId", tipo: "string | null", descricao: "Opcional; campanha de origem." },
      { nome: "mensagemId", tipo: "string | null", descricao: "Opcional; mensagem da sequência." },
      { nome: "descricao", tipo: "string", descricao: "Opcional; texto descritivo do evento." },
      { nome: "detalhes", tipo: "string | null", descricao: "Opcional; detalhes extras (ex.: motivo da falha)." },
      { nome: "texto", tipo: "string | null", descricao: 'Opcional; conteúdo da mensagem enviada (ou da resposta do lead quando kind = "resposta"). Vai no campo `mensagem` do webhook e na timeline. Sem ele, usa o texto da mensagem vinculada por `mensagemId`.' },
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
      "Processa, em todas as instâncias, as mensagens agendadas que já venceram (incluindo as que levam imagem/arquivo anexado) e roda as manutenções periódicas: execuções do No Code, backup automático e follow-ups dos bots. Pensado para agendadores externos (cron-job.org, GitHub Actions, Vercel Cron). ATENÇÃO: a rota é pública; sem `CRON_TOKEN` definido qualquer pessoa que saiba a URL pode acioná-la — defina o token em produção.",
    auth: "Público por padrão. Se `CRON_TOKEN` estiver definido, exige `x-cron-token: <token>` ou `?token=<token>`.",
    queryParams: [{ nome: "token", tipo: "string", descricao: "Token do cron quando CRON_TOKEN está definido." }],
    headers: [{ nome: "x-cron-token", tipo: "string", descricao: "Alternativa ao ?token= para autenticar o cron." }],
    responses: [
      {
        status: 200,
        descricao:
          "Processamento concluído. `processados`/`enviados`/`reiniciados`/`encerrados` são da engine de disparo; `ignorado: true` aparece quando já havia uma varredura em andamento. `followUp`, `nocode` e `backup` só vêm quando a rotina respectiva rodou.",
        exemplo: `{
  "ok": true,
  "processados": 5,
  "enviados": 4,
  "reiniciados": 0,
  "encerrados": 1,
  "followUp": {},
  "nocode": {},
  "backup": { "iniciado": false, "retentados": 0 }
}`,
      },
      { status: 401, descricao: "Token inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
      { status: 500, descricao: "Falha na engine.", exemplo: `{ "ok": false, "erro": "Falha ao processar a engine." }` },
    ],
    curl: `curl -s "$BASE/api/cron?token=SEU_CRON_TOKEN"`,
  },

  "POST /api/cron": {
    resumo: "Aciona a engine de disparo (escrita).",
    descricao: "Idêntico ao GET /api/cron (mesma resposta e mesma regra de token) — disponível como POST para agendadores que preferem esse método.",
    auth: "Público por padrão. Se `CRON_TOKEN` estiver definido, exige `x-cron-token: <token>` ou `?token=<token>`.",
    headers: [{ nome: "x-cron-token", tipo: "string", descricao: "Token do cron quando CRON_TOKEN está definido." }],
    responses: [
      {
        status: 200,
        descricao:
          "Processamento concluído. `processados`/`enviados`/`reiniciados`/`encerrados` são da engine de disparo; `ignorado: true` aparece quando já havia uma varredura em andamento. `followUp`, `nocode` e `backup` só vêm quando a rotina respectiva rodou.",
        exemplo: `{
  "ok": true,
  "processados": 5,
  "enviados": 4,
  "reiniciados": 0,
  "encerrados": 1,
  "followUp": {},
  "nocode": {},
  "backup": { "iniciado": false, "retentados": 0 }
}`,
      },
      { status: 401, descricao: "Token inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
      { status: 500, descricao: "Falha na engine.", exemplo: `{ "ok": false, "erro": "Falha ao processar a engine." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/cron" \\
  -H "x-cron-token: SEU_CRON_TOKEN"`,
  },

  // -------------------------------------------------------------- EVENTOS
  "POST /api/eventos": {
    resumo: "Ingestão de eventos de mensagem (externo).",
    descricao:
      "Endpoint de ingestão para a engine externa gravar eventos na timeline do lead. Idêntico em efeito ao POST /api/mensagens, mas com a camada extra do token de ingestão.",
    auth: `${sessao("eventos")} Além disso, se \`INGEST_TOKEN\` estiver definido, exige o header \`x-ingest-token: <token>\` (sem ele: 401). Sem a env definida, só vale a autenticação acima.`,
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
      { nome: "texto", tipo: "string | null", descricao: 'Opcional; conteúdo da mensagem enviada (ou da resposta do lead quando kind = "resposta"). Vai no campo `mensagem` do webhook e na timeline.' },
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
      { status: 401, descricao: "Sem credencial válida, ou token de ingestão inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
      { status: 403, descricao: "Usuário sem acesso à seção de eventos.", exemplo: `{ "ok": false, "erro": "Sem permissão para acessar este recurso." }` },
      { status: 404, descricao: "Lead não encontrado.", exemplo: `{ "ok": false, "erro": "Lead não encontrado." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/eventos" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer SEU_API_TOKEN" \\
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
  // ---------------------------------------------------------------- FOTOS
  "GET /api/leads/:id/foto": {
    resumo: "Foto de perfil do WhatsApp do lead.",
    descricao:
      "Busca a foto de perfil do lead na Evolution API (em todas as instâncias cadastradas) e a devolve pelo servidor, para não expor a apikey e porque as URLs do WhatsApp expiram. Resposta binária (imagem), com cache privado de 30 minutos. 410 significa que não há foto (ou o número não está no WhatsApp, ou o lead não existe): o cliente não deve tentar de novo até o lead ser editado. 502 é falha temporária — pode tentar de novo.",
    auth: SESSAO_LEADS,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do lead." }],
    responses: [
      { status: 200, descricao: "Imagem (Content-Type image/*).", exemplo: `(bytes da imagem)` },
      { status: 410, descricao: "Sem foto, número fora do WhatsApp ou lead inexistente. Corpo vazio.", exemplo: `(sem corpo)` },
      { status: 502, descricao: "Falha temporária ao buscar a foto. Corpo vazio.", exemplo: `(sem corpo)` },
      { status: 401, descricao: "Sem credencial.", exemplo: `{ "ok": false, "erro": "Não autorizado." }` },
    ],
    curl: `curl -s "$BASE/api/leads/lead_a1b2c3/foto" \\
  -H "Authorization: Bearer SEU_API_TOKEN" \\
  -o foto.jpg`,
  },

  "GET /api/usuarios/:id/foto": {
    resumo: "Foto de perfil de um usuário do painel.",
    descricao:
      "Devolve a foto de um usuário para quem está logado e pode vê-lo (mesma instância; o Root também vê a dos administradores). Resposta binária. A URL usada pelo painel leva `?v=<momento da troca>`: por isso o navegador guarda a imagem em cache por um ano — ao trocar a foto a URL muda. 404 significa sem foto (o painel mostra as iniciais).",
    auth: "Só sessão de navegador (cookie `campanhas_session`). O `API_TOKEN` não identifica um usuário e retorna 401.",
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do usuário." }],
    queryParams: [{ nome: "v", tipo: "string", descricao: "Opcional; marca da versão da foto, só para o cache do navegador." }],
    responses: [
      { status: 200, descricao: "Imagem (o Content-Type é o da foto salva).", exemplo: `(bytes da imagem)` },
      { status: 401, descricao: "Sem sessão. Corpo vazio.", exemplo: `(sem corpo)` },
      { status: 404, descricao: "Usuário sem foto, ou sem permissão para vê-lo. Corpo vazio.", exemplo: `(sem corpo)` },
    ],
    curl: `curl -s "$BASE/api/usuarios/user_k2m3/foto" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -o usuario.jpg`,
  },

  // ----------------------------------------------------------------- CHAT
  "GET /api/chat/arquivo/:id": {
    resumo: "Baixa uma imagem/arquivo recebido de um lead (uso único).",
    descricao:
      "Entrega o arquivo que um lead enviou no WhatsApp. O app não guarda esses arquivos: o conteúdo fica numa pasta temporária do servidor e é APAGADO assim que o download termina; se o download for interrompido no meio, o arquivo continua para uma nova tentativa. Só fotos .jpg/.jpeg/.png/.webp chegam como imagem; todo o resto (gif, vídeo, pdf, planilhas…) chega como documento, com o nome e a extensão originais. O `id` aparece na linha `Arquivo: <id>;<tipo>;<mime>;<bytes>;<nome>` da timeline da conversa. Confere que o arquivo pertence a uma conversa da instância do usuário.",
    auth: "Só sessão de navegador (cookie `campanhas_session`). O `API_TOKEN` não identifica um usuário e retorna 401.",
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do arquivo (UUID), como aparece na timeline." }],
    responses: [
      {
        status: 200,
        descricao: "Arquivo como anexo. Cabeçalhos: Content-Type (mime original), Content-Length, Content-Disposition (attachment; filename com o nome original), Cache-Control: no-store.",
        exemplo: `(bytes do arquivo)`,
      },
      { status: 400, descricao: "ID em formato inválido.", exemplo: `{ "ok": false, "erro": "Arquivo inválido." }` },
      { status: 401, descricao: "Sem sessão.", exemplo: `{ "ok": false, "erro": "Não autorizado." }` },
      { status: 404, descricao: "Não pertence a uma conversa desta instância, ou já foi baixado / expirou.", exemplo: `{ "ok": false, "erro": "Este arquivo já foi baixado ou expirou e foi removido do servidor." }` },
    ],
    curl: `curl -s "$BASE/api/chat/arquivo/9b1d6e0a-4c3f-4a8e-b2d1-7f5a6c8e9d10" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -OJ`,
  },

  "GET /api/chat/audio/:id": {
    resumo: "Entrega uma mensagem de voz guardada no servidor.",
    descricao:
      "Devolve o áudio de uma conversa para o player do chat. Aceita o header `Range` (resposta 206) para o player avançar e voltar. O arquivo fica no servidor pelo período de retenção dos áudios (`AUDIO_RETENTION_DAYS`, padrão 30 dias) e depois some: 404. Confere que o áudio pertence a uma conversa da instância do usuário. O `id` aparece na linha `Audio: <id>` da timeline.",
    auth: "Só sessão de navegador (cookie `campanhas_session`). O `API_TOKEN` não identifica um usuário e retorna 401.",
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do áudio: UUID com a extensão do arquivo (.webm, .ogg, .m4a, .aac, .mp3 ou .wav), como aparece na linha `Audio:` da timeline." }],
    headers: [{ nome: "Range", tipo: "string", descricao: "Opcional; ex.: bytes=0-1023, para baixar só um trecho." }],
    responses: [
      { status: 200, descricao: "Áudio completo (Accept-Ranges: bytes).", exemplo: `(bytes do áudio)` },
      { status: 206, descricao: "Trecho pedido em `Range` (Content-Range informa o intervalo).", exemplo: `(bytes do trecho)` },
      { status: 400, descricao: "ID em formato inválido (UUID + extensão de áudio).", exemplo: `{ "ok": false, "erro": "Áudio inválido." }` },
      { status: 401, descricao: "Sem sessão.", exemplo: `{ "ok": false, "erro": "Não autorizado." }` },
      { status: 404, descricao: "Áudio não encontrado nesta instância, ou expirado.", exemplo: `{ "ok": false, "erro": "Este áudio expirou e foi removido do servidor." }` },
      { status: 416, descricao: "Intervalo de `Range` fora do tamanho do arquivo.", exemplo: `(sem corpo)` },
    ],
    curl: `curl -s "$BASE/api/chat/audio/2c7e1f90-8a3b-4d5c-9e6f-0a1b2c3d4e5f.ogg" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -o audio.ogg`,
  },

  "GET /api/chat/interno/arquivo/:id": {
    resumo: "Baixa um anexo do chat interno (entre usuários).",
    descricao:
      "Entrega a imagem/arquivo enviado numa conversa do chat interno. O conteúdo não fica no banco: quando TODOS os outros participantes da conversa terminam o download, o arquivo é apagado do servidor. Download interrompido não conta. Só participantes da conversa baixam; o autor pode baixar o próprio envio sem afetar a exclusão.",
    auth: `${sessao("chat")} Por ser uma rota de usuário, o \`API_TOKEN\` não serve: sem sessão de navegador retorna 401.`,
    pathParams: [{ nome: "id", tipo: "string", obrigatorio: true, descricao: "ID do anexo do chat interno." }],
    responses: [
      {
        status: 200,
        descricao: "Arquivo como anexo (Content-Type original, Content-Disposition com o nome original, Cache-Control: no-store).",
        exemplo: `(bytes do arquivo)`,
      },
      { status: 400, descricao: "ID em formato inválido.", exemplo: `{ "ok": false, "erro": "Arquivo inválido." }` },
      { status: 401, descricao: "Sem sessão de usuário.", exemplo: `{ "ok": false, "erro": "Não autorizado." }` },
      { status: 403, descricao: "Usuário sem acesso ao chat.", exemplo: `{ "ok": false, "erro": "Sem permissão para acessar este recurso." }` },
      { status: 404, descricao: "Não é participante da conversa, ou o arquivo já foi baixado por todos / expirou.", exemplo: `{ "ok": false, "erro": "Arquivo não encontrado." }` },
    ],
    curl: `curl -s "$BASE/api/chat/interno/arquivo/5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a" \\
  -H "Cookie: campanhas_session=SEU_TOKEN" \\
  -OJ`,
  },

  // --------------------------------------------------------------- BACKUP
  "GET /api/backup/download": {
    resumo: "Baixa o backup como arquivo .json.",
    descricao:
      "Gera o backup das seções escolhidas e o devolve como arquivo (stream, `application/json`), sem precisar de webhook. Mesmo acesso da página de Configurações. As chaves de seção aceitas são: leads, campanhas, segmentacao, agendadas, historico, crm, nocode, nocode_execucoes, usuarios, integracoes, configuracoes, eventos_entrada e logs. Chaves desconhecidas são ignoradas; sem nenhuma válida retorna 400. As imagens, vídeos e arquivos anexados às campanhas ficam num volume do servidor e NÃO vão no backup (só a referência na mensagem).",
    auth: SESSAO_CONFIG,
    queryParams: [{ nome: "secoes", tipo: "string", obrigatorio: true, descricao: "Chaves das seções separadas por vírgula, ex.: leads,campanhas." }],
    responses: [
      { status: 200, descricao: "Arquivo de backup (Content-Disposition: attachment; filename=\"…json\").", exemplo: `{ "formato": "...", "versao": 1, "id": "...", "geradoEm": "2026-10-10T12:00:00.000Z", "secoes": ["leads"], "tabelas": { "Lead": [ /* ... */ ] } }` },
      { status: 400, descricao: "Nenhuma seção válida informada.", exemplo: `{ "ok": false, "erro": "Selecione ao menos uma seção para o backup." }` },
      { status: 500, descricao: "Falha ao gerar o backup.", exemplo: `{ "ok": false, "erro": "Não foi possível gerar o backup." }` },
    ],
    curl: `curl -s "$BASE/api/backup/download?secoes=leads,campanhas" \\
  -H "Authorization: Bearer SEU_API_TOKEN" \\
  -o backup.json`,
  },

  "POST /api/backup/restaurar": {
    resumo: "Restaura dados a partir de um arquivo de backup.",
    descricao:
      "Recebe o arquivo .json gerado por \"Baixar backup\" e restaura as seções escolhidas. O corpo é o próprio arquivo (`application/json`), enviado SEM multipart, para ser lido em fluxo; o limite é 1 GB. Com `simular=1` só analisa e conta, sem gravar. `modo=mesclar` (padrão) só adiciona o que falta; `modo=sobrescrever` substitui. A seção `usuarios` só o usuário root pode restaurar (com `API_TOKEN` não há essa trava). Os arquivos anexados às campanhas não fazem parte do backup: mensagens restauradas mantêm a referência, mas, se o arquivo não existir no servidor, o envio falha pedindo para anexar de novo. A rota fica fora do limite de corpo do proxy do painel e se protege sozinha com a mesma autenticação das demais.",
    auth: SESSAO_CONFIG,
    queryParams: [
      { nome: "secoes", tipo: "string", obrigatorio: true, descricao: "Chaves das seções a restaurar, separadas por vírgula (mesmas de /api/backup/download)." },
      { nome: "modo", tipo: "enum", descricao: "`mesclar` (padrão) ou `sobrescrever`." },
      { nome: "simular", tipo: "string", descricao: "`1` ou `true`: só analisa e conta, não grava." },
    ],
    headers: [{ nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json — o corpo é o arquivo de backup inteiro." }],
    responses: [
      {
        status: 200,
        descricao:
          "Fluxo NDJSON (`application/x-ndjson`), uma linha por evento: `fase`, `progresso`, `fim` (com o resultado) ou `erro`. Se o cliente desconectar, a restauração continua até o fim.",
        exemplo: `{"tipo":"fase","mensagem":"Arquivo recebido e validado."}
{"tipo":"progresso","tabela":"Lead","feitas":500,"total":1200,"tabelasConcluidas":0,"totalTabelas":3}
{"tipo":"fim","resultado":{ /* resumo por tabela */ }}`,
      },
      { status: 400, descricao: "Sem seções, modo inválido, sem corpo ou arquivo inválido.", exemplo: `{ "ok": false, "erro": "Selecione ao menos uma seção para restaurar." }` },
      { status: 403, descricao: "Seção restrita ao root, ou sem acesso a Configurações.", exemplo: `{ "ok": false, "erro": "Só o usuário root pode restaurar a seção de Usuários." }` },
      { status: 413, descricao: "Arquivo acima do limite.", exemplo: `{ "ok": false, "erro": "O arquivo passa de 1024 MB, que é o limite aceito." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/backup/restaurar?secoes=leads,campanhas&modo=mesclar&simular=1" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer SEU_API_TOKEN" \\
  --data-binary @backup.json`,
  },

  // ------------------------------------------------------------------ MCP
  "POST /api/mcp": {
    resumo: "Endpoint MCP (Model Context Protocol) da instância.",
    descricao:
      "Permite conectar um cliente MCP (Claude.ai Connectors, Claude Desktop, Claude Code…) a UMA instância do painel, expondo só as funções que o dono do token liberou em Integrações e respeitando os plugins ativos. O MCP vem desligado: sem token válido a rota recusa (401) e as ferramentas só rodam na instância dona do token. Modo stateless (Streamable HTTP, resposta JSON): cada chamada cria o servidor do zero, sem sessão MCP guardada.",
    auth: "Token do MCP da instância (gerado em Integrações), em `Authorization: Bearer mcp_…` (preferido), no header `x-mcp-token` ou em `?token=mcp_…` na URL (para conectores que só pedem a URL — trate a URL como senha). O `API_TOKEN` e a sessão do navegador NÃO dão acesso. A rota é pública para o proxy do painel; quem a protege é o próprio token.",
    queryParams: [{ nome: "token", tipo: "string", descricao: "Alternativa aos headers, para conectores que só aceitam URL." }],
    headers: [
      { nome: "Authorization", tipo: "string", descricao: "Bearer mcp_<token>." },
      { nome: "x-mcp-token", tipo: "string", descricao: "Alternativa ao Authorization." },
      { nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" },
      { nome: "Accept", tipo: "string", obrigatorio: true, descricao: "application/json, text/event-stream (exigido pelo transporte MCP)." },
    ],
    bodyFields: [
      { nome: "jsonrpc", tipo: "string", obrigatorio: true, descricao: '"2.0".' },
      { nome: "id", tipo: "string | number", descricao: "Identificador da chamada (ausente em notificações)." },
      { nome: "method", tipo: "string", obrigatorio: true, descricao: "Método MCP, ex.: initialize, tools/list, tools/call." },
      { nome: "params", tipo: "object", descricao: "Parâmetros do método." },
    ],
    requestExample: `{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }`,
    responses: [
      { status: 200, descricao: "Resposta JSON-RPC do servidor MCP.", exemplo: `{ "jsonrpc": "2.0", "id": 1, "result": { "tools": [ /* funções liberadas pelo token */ ] } }` },
      {
        status: 401,
        descricao: "Token ausente, inválido, desativado ou removido (com `www-authenticate: Bearer realm=\"mcp\"`).",
        exemplo: `{ "jsonrpc": "2.0", "error": { "code": -32001, "message": "Token do MCP inválido, desativado ou removido." }, "id": null }`,
      },
      { status: 500, descricao: "Erro interno do servidor MCP.", exemplo: `{ "jsonrpc": "2.0", "error": { "code": -32603, "message": "Erro interno do servidor MCP." }, "id": null }` },
    ],
    curl: `curl -s -X POST "$BASE/api/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Authorization: Bearer mcp_SEU_TOKEN" \\
  -d '{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }'`,
  },

  "GET /api/mcp": {
    resumo: "Não suportado (endpoint stateless).",
    descricao: "O MCP deste painel é stateless: não há stream de servidor para abrir. Qualquer GET responde 405, sem checar o token.",
    auth: "Nenhuma (a resposta é sempre 405).",
    responses: [
      { status: 405, descricao: "Método não suportado.", exemplo: `{ "jsonrpc": "2.0", "error": { "code": -32000, "message": "Método não suportado neste endpoint stateless." }, "id": null }` },
    ],
    curl: `curl -s "$BASE/api/mcp"`,
  },

  "DELETE /api/mcp": {
    resumo: "Não suportado (endpoint stateless).",
    descricao: "Não existe sessão MCP para encerrar. Qualquer DELETE responde 405, sem checar o token.",
    auth: "Nenhuma (a resposta é sempre 405).",
    responses: [
      { status: 405, descricao: "Método não suportado.", exemplo: `{ "jsonrpc": "2.0", "error": { "code": -32000, "message": "Método não suportado neste endpoint stateless." }, "id": null }` },
    ],
    curl: `curl -s -X DELETE "$BASE/api/mcp"`,
  },

  // --------------------------------------------------------------- NO CODE
  "POST /api/nocode/webhook/:flowId": {
    resumo: "Entrada de eventos da Evolution API para um fluxo No Code.",
    descricao:
      "Endpoint público que a Evolution API chama (webhook da instância) para disparar um fluxo do plugin No Code. Responde na hora e executa o fluxo em seguida, para a Evolution não esperar nem reenviar enquanto o fluxo roda. O fluxo define a instância: tudo roda dentro dela. No fluxo de resposta do sistema, a mensagem do lead também aciona os bots de departamento (quando há bot ativo, nenhum humano na conversa e o lead não estava em campanha). Fluxo desativado, plugin desligado ou grafo inválido respondem 202 sem executar.",
    auth: "Público: o token do bloco Webhook do fluxo vai em `?token=<token>` ou no header `x-webhook-token`. Token inválido: 401.",
    pathParams: [{ nome: "flowId", tipo: "string", obrigatorio: true, descricao: "ID do fluxo No Code." }],
    queryParams: [{ nome: "token", tipo: "string", descricao: "Token do bloco Webhook (alternativa ao header)." }],
    headers: [
      { nome: "x-webhook-token", tipo: "string", descricao: "Token do bloco Webhook (alternativa ao ?token=)." },
      { nome: "Content-Type", tipo: "string", obrigatorio: true, descricao: "application/json" },
    ],
    bodyFields: [{ nome: "(payload da Evolution)", tipo: "object", obrigatorio: true, descricao: "O corpo do webhook da Evolution, sem alteração (ex.: event, instance, data.key, data.message)." }],
    requestExample: `{
  "event": "messages.upsert",
  "instance": "minha-instancia",
  "data": {
    "key": { "remoteJid": "5551999999999@s.whatsapp.net", "fromMe": false, "id": "ABC123" },
    "pushName": "Marina",
    "message": { "conversation": "Tenho interesse" }
  }
}`,
    responses: [
      { status: 200, descricao: "Evento aceito; o fluxo roda em segundo plano.", exemplo: `{ "ok": true }` },
      { status: 202, descricao: "Recebido, mas não executado (fluxo desativado, plugin desligado ou grafo inválido). `ok` é true.", exemplo: `{ "ok": true, "erro": "Fluxo desativado." }` },
      { status: 400, descricao: "Corpo não é JSON.", exemplo: `{ "ok": false, "erro": "Corpo inválido: esperado JSON." }` },
      { status: 401, descricao: "Token inválido.", exemplo: `{ "ok": false, "erro": "Token inválido." }` },
      { status: 404, descricao: "Fluxo não encontrado.", exemplo: `{ "ok": false, "erro": "Fluxo não encontrado." }` },
    ],
    curl: `curl -s -X POST "$BASE/api/nocode/webhook/flow_a1b2c3?token=SEU_TOKEN_DO_BLOCO" \\
  -H "Content-Type: application/json" \\
  -d '{ "event": "messages.upsert", "instance": "minha-instancia", "data": { "key": { "remoteJid": "5551999999999@s.whatsapp.net", "fromMe": false, "id": "ABC123" }, "message": { "conversation": "Oi" } } }'`,
  },

}

/** Retorna a doc de um método/rota, se existir. */
export function getEndpointDoc(method: string, urlPath: string): EndpointDoc | null {
  return API_DOCS[`${method} ${urlPath}`] ?? null
}
