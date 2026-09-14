import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"

import { formatDate, formatDateTime, formatPercent } from "@/lib/format"
import type { CampaignFormerLead, CampaignResponder, CampaignWithStats } from "@/services/campaigns"
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_TIPO_LABEL, LEAD_STATUS_LABEL, type LeadStatus } from "@/types"

/** Um lead ainda vinculado à campanha (recebendo a sequência, não respondeu ainda). */
export interface CampaignExportLeadAtivo {
  id: string
  nome: string
  telefone: string
  produto: string
  status: LeadStatus
  mensagensEnviadas: number
  ultimoContato: string | null
  proximaMensagemEm: string | null
}

export interface CampaignExportData {
  campanha: CampaignWithStats
  /** Leads que continuam na campanha, ainda sem responder. */
  vinculados: CampaignExportLeadAtivo[]
  /** Leads que já responderam (saíram da sequência ao responder). */
  respondentes: CampaignResponder[]
  /** Leads que saíram sem responder (campanha encerrada, filtro mudou, remoção manual). */
  saidos: CampaignFormerLead[]
}

const CAB_VINCULADOS = ["Nome", "Telefone", "Produto", "Status atual", "Mensagens enviadas", "Próxima mensagem", "Último contato"]
const CAB_RESPONDERAM = ["Nome", "Telefone", "Status atual", "Respostas", "Última resposta"]
const CAB_SAIRAM = ["Nome", "Telefone", "Status atual", "Entrou em"]

/** Linhas [rótulo, valor] com o resumo da campanha — reaproveitadas nos três formatos. */
function linhasResumo({ campanha, vinculados, saidos }: CampaignExportData): [string, string][] {
  const filtros = [
    campanha.filtros.produto && `Produto: ${campanha.filtros.produto}`,
    campanha.filtros.marca && `Marca: ${campanha.filtros.marca}`,
    campanha.filtros.persona && `Persona: ${campanha.filtros.persona}`,
    campanha.filtros.regiao && `Região: ${campanha.filtros.regiao}`,
  ].filter((v): v is string => Boolean(v))

  const responderam = campanha.totalLeads - campanha.leadsPendentes

  return [
    ["Campanha", campanha.nome],
    ["Status", CAMPAIGN_STATUS_LABEL[campanha.status]],
    ["Tipo", CAMPAIGN_TIPO_LABEL[campanha.tipo]],
    ["ID de importação", String(campanha.idImportacao)],
    ["Criada em", formatDate(campanha.criadoEm)],
    ["Data limite", campanha.dataFinal ? formatDate(campanha.dataFinal) : "Sem data limite"],
    ["Recorrência", campanha.tipo === "individual" ? "Disparo único, sem repetição" : `${campanha.recorrenciaDias} dias`],
    ["Instância de envio", campanha.instanciaNome ?? "Padrão do ambiente"],
    [
      "Filtros de público",
      campanha.tipo === "individual" ? "Seleção manual" : filtros.length ? filtros.join(" · ") : "Todos os leads",
    ],
    ["Total de leads", String(campanha.totalLeads)],
    ["Responderam", String(responderam)],
    ["Não responderam (total)", String(campanha.leadsPendentes)],
    ["   dos quais ainda na campanha", String(vinculados.length)],
    ["   dos quais saíram sem responder", String(saidos.length)],
    ["Mensagens enviadas", String(campanha.mensagensEnviadas)],
    ["Taxa de resposta", formatPercent(campanha.taxaResposta)],
    ["Taxa de conversão", formatPercent(campanha.taxaConversao)],
    ["Exportado em", formatDateTime(new Date())],
  ]
}

function linhasVinculados(vinculados: CampaignExportLeadAtivo[]): string[][] {
  return vinculados.map((l) => [
    l.nome,
    l.telefone,
    l.produto,
    LEAD_STATUS_LABEL[l.status],
    String(l.mensagensEnviadas),
    l.proximaMensagemEm ? formatDateTime(l.proximaMensagemEm) : "—",
    l.ultimoContato ? formatDateTime(l.ultimoContato) : "—",
  ])
}

function linhasResponderam(respondentes: CampaignResponder[]): string[][] {
  return respondentes.map((l) => [
    l.leadNome,
    l.leadTelefone,
    LEAD_STATUS_LABEL[l.leadStatus],
    String(l.totalRespostas),
    formatDateTime(l.ultimaRespostaEm),
  ])
}

function linhasSairam(saidos: CampaignFormerLead[]): string[][] {
  return saidos.map((l) => [l.leadNome, l.leadTelefone, LEAD_STATUS_LABEL[l.leadStatus], formatDate(l.entrouEm)])
}

/** Slug seguro para nome de arquivo a partir do nome da campanha. */
function nomeArquivo(campanha: CampaignWithStats, extensao: string): string {
  const slug = campanha.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .toLowerCase()
  return `campanha-${slug || campanha.idImportacao}-resultados.${extensao}`
}

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = nome
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// XLSX — uma aba por seção (Resumo, Responderam, Não responderam, Saíram).
// ---------------------------------------------------------------------------

export function exportCampaignToXlsx(data: CampaignExportData): void {
  const workbook = XLSX.utils.book_new()

  const abaResumo = XLSX.utils.aoa_to_sheet(linhasResumo(data))
  abaResumo["!cols"] = [{ wch: 30 }, { wch: 44 }]
  XLSX.utils.book_append_sheet(workbook, abaResumo, "Resumo")

  const abaResponderam = XLSX.utils.aoa_to_sheet([CAB_RESPONDERAM, ...linhasResponderam(data.respondentes)])
  XLSX.utils.book_append_sheet(workbook, abaResponderam, "Responderam")

  const abaVinculados = XLSX.utils.aoa_to_sheet([CAB_VINCULADOS, ...linhasVinculados(data.vinculados)])
  XLSX.utils.book_append_sheet(workbook, abaVinculados, "Não responderam (ativos)")

  const abaSairam = XLSX.utils.aoa_to_sheet([CAB_SAIRAM, ...linhasSairam(data.saidos)])
  XLSX.utils.book_append_sheet(workbook, abaSairam, "Saíram sem responder")

  XLSX.writeFile(workbook, nomeArquivo(data.campanha, "xlsx"))
}

// ---------------------------------------------------------------------------
// CSV — formato de tabela única, então o resumo vira um bloco de cabeçalho e
// os leads das três categorias viram uma tabela com coluna "Situação".
// Delimitador ";" (padrão do Excel em pt-BR) e BOM UTF-8 para acentuação.
// ---------------------------------------------------------------------------

function csvEscape(valor: string): string {
  return /[;"\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

function linhaCsv(campos: string[]): string {
  return campos.map(csvEscape).join(";")
}

export function exportCampaignToCsv(data: CampaignExportData): void {
  const blocoResumo = linhasResumo(data).map(([rotulo, valor]) => linhaCsv([rotulo, valor]))

  const cabecalhoTabela = ["Situação", "Nome", "Telefone", "Status atual", "Mensagens/Respostas", "Data relevante"]
  const linhasTabela: string[][] = [
    ...data.respondentes.map((l) => [
      "Respondeu",
      l.leadNome,
      l.leadTelefone,
      LEAD_STATUS_LABEL[l.leadStatus],
      `${l.totalRespostas} resposta(s)`,
      formatDateTime(l.ultimaRespostaEm),
    ]),
    ...data.vinculados.map((l) => [
      "Não respondeu (ainda na campanha)",
      l.nome,
      l.telefone,
      LEAD_STATUS_LABEL[l.status],
      `${l.mensagensEnviadas} enviada(s)`,
      l.ultimoContato ? formatDateTime(l.ultimoContato) : "—",
    ]),
    ...data.saidos.map((l) => [
      "Não respondeu (saiu da campanha)",
      l.leadNome,
      l.leadTelefone,
      LEAD_STATUS_LABEL[l.leadStatus],
      "—",
      formatDate(l.entrouEm),
    ]),
  ]

  const conteudo = [...blocoResumo, "", linhaCsv(cabecalhoTabela), ...linhasTabela.map(linhaCsv)].join("\r\n")
  baixarBlob(new Blob([`\uFEFF${conteudo}`], { type: "text/csv;charset=utf-8;" }), nomeArquivo(data.campanha, "csv"))
}

// ---------------------------------------------------------------------------
// PDF — resumo em tabela de duas colunas, seguido de uma tabela por seção.
// ---------------------------------------------------------------------------

function finalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30
}

export function exportCampaignToPdf(data: CampaignExportData): void {
  const doc = new jsPDF()

  doc.setFontSize(14)
  doc.text(`Resultados da campanha`, 14, 16)
  doc.setFontSize(11)
  doc.text(data.campanha.nome, 14, 23)

  autoTable(doc, {
    startY: 28,
    body: linhasResumo(data),
    styles: { fontSize: 8, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 65 } },
    theme: "plain",
  })

  let y = finalY(doc) + 8

  function secao(titulo: string, cabecalho: string[], linhas: string[][]) {
    if (y > 260) {
      doc.addPage()
      y = 16
    }
    doc.setFontSize(11)
    doc.text(titulo, 14, y)
    y += 4
    autoTable(doc, {
      startY: y,
      head: [cabecalho],
      body: linhas.length ? linhas : [cabecalho.map(() => "—")],
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59] },
      margin: { top: 16 },
    })
    y = finalY(doc) + 10
  }

  secao(`Responderam (${data.respondentes.length})`, CAB_RESPONDERAM, linhasResponderam(data.respondentes))
  secao(`Não responderam · ainda na campanha (${data.vinculados.length})`, CAB_VINCULADOS, linhasVinculados(data.vinculados))
  secao(`Não responderam · saíram sem responder (${data.saidos.length})`, CAB_SAIRAM, linhasSairam(data.saidos))

  doc.save(nomeArquivo(data.campanha, "pdf"))
}
