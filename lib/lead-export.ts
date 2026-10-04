import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"

import { formatDate, formatDateTime } from "@/lib/format"
import type { LeadRow } from "@/services/leads"
import { LEAD_STATUS_LABEL } from "@/types"

/** De onde vieram os leads exportados: só os selecionados, o filtro da tela ou a base inteira. */
export type EscopoExportacao = "selecionados" | "filtrados" | "todos"

export interface LeadExportData {
  leads: LeadRow[]
  escopo: EscopoExportacao
}

const LABEL_ESCOPO: Record<EscopoExportacao, string> = {
  selecionados: "Leads selecionados",
  filtrados: "Leads filtrados",
  todos: "Todos os leads",
}

const CAB_COMPLETO = [
  "Nome",
  "Telefone",
  "Negócio",
  "Atividade",
  "Produto",
  "Marca",
  "Persona",
  "Região",
  "Campanha",
  "Status",
  "Mensagens enviadas",
  "Respostas",
  "Último contato",
  "Entrada na campanha",
  "Criado em",
  "Notas",
]

// O PDF é uma folha: só as colunas que cabem e importam para leitura rápida.
const CAB_PDF = [
  "Nome",
  "Telefone",
  "Produto",
  "Marca",
  "Persona",
  "Região",
  "Campanha",
  "Status",
  "Env.",
  "Resp.",
  "Último contato",
]

const dataOuVazio = (valor: string | null, formato: (v: string) => string) => (valor ? formato(valor) : "")

function nomesCampanha(lead: LeadRow): string {
  if (lead.campanhasNomes.length > 0) return lead.campanhasNomes.join("; ")
  return lead.campanhaNome ?? ""
}

/** Linha completa (xlsx/csv). Tudo como texto para o telefone não virar número no Excel. */
function linhaCompleta(lead: LeadRow): string[] {
  return [
    lead.nome,
    lead.telefone,
    lead.negocio ?? "",
    lead.atividade ?? "",
    lead.produto,
    lead.marca,
    lead.persona,
    lead.regiao,
    nomesCampanha(lead),
    LEAD_STATUS_LABEL[lead.status] ?? lead.status,
    String(lead.mensagensEnviadas),
    String(lead.respostas),
    dataOuVazio(lead.ultimoContato, formatDateTime),
    dataOuVazio(lead.entradaCampanhaEm, formatDateTime),
    dataOuVazio(lead.criadoEm, formatDateTime),
    lead.notas ?? "",
  ]
}

function linhaPdf(lead: LeadRow): string[] {
  return [
    lead.nome,
    lead.telefone,
    lead.produto,
    lead.marca,
    lead.persona,
    lead.regiao,
    nomesCampanha(lead),
    LEAD_STATUS_LABEL[lead.status] ?? lead.status,
    String(lead.mensagensEnviadas),
    String(lead.respostas),
    dataOuVazio(lead.ultimoContato, formatDate),
  ]
}

function nomeArquivo(escopo: EscopoExportacao, extensao: string): string {
  const carimbo = new Date().toISOString().slice(0, 10)
  const sufixo = escopo === "selecionados" ? "-selecionados" : escopo === "filtrados" ? "-filtrados" : ""
  return `leads${sufixo}-${carimbo}.${extensao}`
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
// XLSX
// ---------------------------------------------------------------------------

export function exportLeadsToXlsx({ leads, escopo }: LeadExportData): void {
  const aba = XLSX.utils.aoa_to_sheet([CAB_COMPLETO, ...leads.map(linhaCompleta)])
  aba["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 26 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 40 },
  ]
  aba["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(leads.length, 1), c: CAB_COMPLETO.length - 1 } }) }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, aba, "Leads")
  XLSX.writeFile(workbook, nomeArquivo(escopo, "xlsx"))
}

// ---------------------------------------------------------------------------
// CSV — delimitador ";" (padrão do Excel em pt-BR) e BOM UTF-8 para os acentos.
// ---------------------------------------------------------------------------

/**
 * O Excel executa como fórmula a célula que começa com = ou @ (e com + ou -
 * quando não é um telefone). Nome/notas vêm de importações, então neutralizamos
 * com um apóstrofo antes de gravar. Telefones como "+55 79 99999-0000" ficam intactos.
 */
function neutralizarFormula(valor: string): string {
  if (/^[=@\t\r]/.test(valor)) return `'${valor}`
  if (/^[+-]/.test(valor) && !/^[+-][\d\s().-]+$/.test(valor)) return `'${valor}`
  return valor
}

function csvEscape(valor: string): string {
  const seguro = neutralizarFormula(valor)
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

export function exportLeadsToCsv({ leads, escopo }: LeadExportData): void {
  const linhas = [CAB_COMPLETO, ...leads.map(linhaCompleta)].map((linha) => linha.map(csvEscape).join(";"))
  const blob = new Blob([`\uFEFF${linhas.join("\r\n")}`], { type: "text/csv;charset=utf-8;" })
  baixarBlob(blob, nomeArquivo(escopo, "csv"))
}

// ---------------------------------------------------------------------------
// JSON — todos os campos úteis, com ids e datas em ISO (bom para integrações).
// ---------------------------------------------------------------------------

export function exportLeadsToJson({ leads, escopo }: LeadExportData): void {
  const payload = {
    exportadoEm: new Date().toISOString(),
    escopo: LABEL_ESCOPO[escopo],
    total: leads.length,
    leads: leads.map((lead) => ({
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      negocio: lead.negocio,
      atividade: lead.atividade,
      produto: lead.produto,
      marca: lead.marca,
      persona: lead.persona,
      regiao: lead.regiao,
      status: lead.status,
      campanhas: lead.campanhasIds.map((id, indice) => ({ id, nome: lead.campanhasNomes[indice] ?? null })),
      mensagensEnviadas: lead.mensagensEnviadas,
      respostas: lead.respostas,
      ultimoContato: lead.ultimoContato,
      entradaCampanhaEm: lead.entradaCampanhaEm,
      criadoEm: lead.criadoEm,
      notas: lead.notas,
    })),
  }
  baixarBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), nomeArquivo(escopo, "json"))
}

// ---------------------------------------------------------------------------
// PDF — paisagem, tabela com quebra de página e cabeçalho repetido.
// ---------------------------------------------------------------------------

export function exportLeadsToPdf({ leads, escopo }: LeadExportData): void {
  const doc = new jsPDF({ orientation: "landscape" })

  doc.setFontSize(14)
  doc.text("Leads", 14, 14)
  doc.setFontSize(9)
  doc.text(`${LABEL_ESCOPO[escopo]}: ${leads.length} · Exportado em ${formatDateTime(new Date())}`, 14, 20)

  autoTable(doc, {
    startY: 25,
    head: [CAB_PDF],
    body: leads.map(linhaPdf),
    styles: { fontSize: 7.5, cellPadding: 1.5, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 10, right: 10, top: 14 },
    columnStyles: { 8: { halign: "right" }, 9: { halign: "right" } },
    didDrawPage: () => {
      const pagina = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.text(`Página ${pagina}`, doc.internal.pageSize.getWidth() - 10, doc.internal.pageSize.getHeight() - 6, {
        align: "right",
      })
    },
  })

  doc.save(nomeArquivo(escopo, "pdf"))
}
