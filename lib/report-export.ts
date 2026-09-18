import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"

import { formatDateTime, formatPercent } from "@/lib/format"
import type {
  CampanhaPerformance,
  DimensaoPerformance,
  DistribuicaoPonto,
  FunilPonto,
  MensagemPerformance,
} from "@/services/analytics"

export interface ReportExportData {
  /** `null` quando o respectivo limite do período não foi aplicado. */
  periodo: { de: string | null; ate: string | null }
  funil: FunilPonto[]
  diaSemana: DistribuicaoPonto[]
  horario: DistribuicaoPonto[]
  campanhas: CampanhaPerformance[]
  mensagens: MensagemPerformance[]
  segmentos: {
    produto: DimensaoPerformance[]
    marca: DimensaoPerformance[]
    persona: DimensaoPerformance[]
    regiao: DimensaoPerformance[]
  }
}

const CAB_FUNIL = ["Etapa", "Total"]
const CAB_DISTRIBUICAO = ["Período", "Enviadas", "Respostas", "Taxa de resposta"]
const CAB_CAMPANHAS = ["Campanha", "Leads", "Enviadas", "Respostas", "Taxa de resposta", "Taxa de conversão", "Tempo médio de resposta (dias)"]
const CAB_MENSAGENS = ["Campanha", "Dia", "Horário", "Mensagem", "Enviadas", "Respostas", "Taxa de resposta"]
const CAB_SEGMENTO = ["Valor", "Leads", "Respostas", "Taxa de conversão"]

const LABEL_SEGMENTO: Record<keyof ReportExportData["segmentos"], string> = {
  produto: "Produto",
  marca: "Marca",
  persona: "Persona",
  regiao: "Região",
}

/** Linhas [rótulo, valor] com o resumo do período — reaproveitadas nos três formatos. */
function linhasResumo(data: ReportExportData): [string, string][] {
  return [
    ["Período", periodoLabel(data.periodo)],
    ["Exportado em", formatDateTime(new Date())],
    ...data.funil.map((f) => [f.etapa, String(f.total)] as [string, string]),
  ]
}

function periodoLabel({ de, ate }: ReportExportData["periodo"]): string {
  if (!de && !ate) return "Histórico completo"
  if (de && ate) return `${de} a ${ate}`
  if (de) return `A partir de ${de}`
  return `Até ${ate}`
}

function linhasDistribuicao(pontos: DistribuicaoPonto[]): string[][] {
  return pontos.map((p) => [p.label, String(p.enviadas), String(p.respostas), formatPercent(p.taxa)])
}

function linhasCampanhas(campanhas: CampanhaPerformance[]): string[][] {
  return campanhas.map((c) => [
    c.nome,
    String(c.leads),
    String(c.enviadas),
    String(c.respostas),
    formatPercent(c.taxaResposta),
    formatPercent(c.taxaConversao),
    c.tempoMedioRespostaDias.toFixed(1),
  ])
}

function linhasMensagens(mensagens: MensagemPerformance[]): string[][] {
  return mensagens.map((m) => [
    m.campanha,
    String(m.dia),
    m.horario,
    m.texto,
    String(m.enviadas),
    String(m.respostas),
    formatPercent(m.taxaResposta),
  ])
}

function linhasSegmento(pontos: DimensaoPerformance[]): string[][] {
  return pontos.map((p) => [p.chave, String(p.leads), String(p.respostas), formatPercent(p.taxaConversao)])
}

/** Nome de arquivo com o período aplicado, para diferenciar exportações filtradas. */
function nomeArquivo(periodo: ReportExportData["periodo"], extensao: string): string {
  const carimbo = new Date().toISOString().slice(0, 10)
  const sufixo = periodo.de || periodo.ate ? `-${periodo.de ?? "inicio"}-a-${periodo.ate ?? "hoje"}` : ""
  return `relatorios${sufixo}-${carimbo}.${extensao}`
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
// XLSX — uma aba por seção.
// ---------------------------------------------------------------------------

export function exportReportToXlsx(data: ReportExportData): void {
  const workbook = XLSX.utils.book_new()

  const abaResumo = XLSX.utils.aoa_to_sheet(linhasResumo(data))
  abaResumo["!cols"] = [{ wch: 26 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(workbook, abaResumo, "Resumo")

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([CAB_DISTRIBUICAO, ...linhasDistribuicao(data.diaSemana)]),
    "Dia da semana",
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([CAB_DISTRIBUICAO, ...linhasDistribuicao(data.horario)]),
    "Horário",
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([CAB_CAMPANHAS, ...linhasCampanhas(data.campanhas)]),
    "Campanhas",
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([CAB_MENSAGENS, ...linhasMensagens(data.mensagens)]),
    "Mensagens",
  )
  for (const chave of Object.keys(data.segmentos) as Array<keyof ReportExportData["segmentos"]>) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([CAB_SEGMENTO, ...linhasSegmento(data.segmentos[chave])]),
      LABEL_SEGMENTO[chave],
    )
  }

  XLSX.writeFile(workbook, nomeArquivo(data.periodo, "xlsx"))
}

// ---------------------------------------------------------------------------
// CSV — várias tabelas empilhadas num único arquivo, cada uma com seu título
// e cabeçalho. Delimitador ";" (padrão do Excel em pt-BR) e BOM UTF-8.
// ---------------------------------------------------------------------------

function csvEscape(valor: string): string {
  return /[;"\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

function linhaCsv(campos: string[]): string {
  return campos.map(csvEscape).join(";")
}

function blocoCsv(titulo: string, cabecalho: string[], linhas: string[][]): string[] {
  return [titulo, linhaCsv(cabecalho), ...(linhas.length ? linhas.map(linhaCsv) : [linhaCsv(cabecalho.map(() => "—"))])]
}

export function exportReportToCsv(data: ReportExportData): void {
  const blocos: string[][] = [
    ["Relatórios", periodoLabel(data.periodo)],
    [],
    blocoCsv("Funil", CAB_FUNIL, data.funil.map((f) => [f.etapa, String(f.total)])),
    [],
    blocoCsv("Dia da semana", CAB_DISTRIBUICAO, linhasDistribuicao(data.diaSemana)),
    [],
    blocoCsv("Horário", CAB_DISTRIBUICAO, linhasDistribuicao(data.horario)),
    [],
    blocoCsv("Campanhas", CAB_CAMPANHAS, linhasCampanhas(data.campanhas)),
    [],
    blocoCsv("Mensagens", CAB_MENSAGENS, linhasMensagens(data.mensagens)),
    [],
    ...(Object.keys(data.segmentos) as Array<keyof ReportExportData["segmentos"]>).flatMap((chave) => [
      blocoCsv(LABEL_SEGMENTO[chave], CAB_SEGMENTO, linhasSegmento(data.segmentos[chave])),
      [],
    ]),
  ]

  const conteudo = blocos.flat().join("\r\n")
  baixarBlob(new Blob([`\uFEFF${conteudo}`], { type: "text/csv;charset=utf-8;" }), nomeArquivo(data.periodo, "csv"))
}

// ---------------------------------------------------------------------------
// PDF — uma tabela por seção, com quebra de página automática.
// ---------------------------------------------------------------------------

function finalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30
}

export function exportReportToPdf(data: ReportExportData): void {
  const doc = new jsPDF()

  doc.setFontSize(14)
  doc.text("Relatórios", 14, 16)
  doc.setFontSize(10)
  doc.text(periodoLabel(data.periodo), 14, 23)

  autoTable(doc, {
    startY: 28,
    head: [CAB_FUNIL],
    body: data.funil.map((f) => [f.etapa, String(f.total)]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 41, 59] },
    theme: "plain",
  })

  let y = finalY(doc) + 10

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

  secao("Melhor momento · Dia da semana", CAB_DISTRIBUICAO, linhasDistribuicao(data.diaSemana))
  secao("Melhor momento · Horário", CAB_DISTRIBUICAO, linhasDistribuicao(data.horario))
  secao(`Desempenho por campanha (${data.campanhas.length})`, CAB_CAMPANHAS, linhasCampanhas(data.campanhas))
  secao(`Mensagens com melhor retorno (${data.mensagens.length})`, CAB_MENSAGENS, linhasMensagens(data.mensagens))
  for (const chave of Object.keys(data.segmentos) as Array<keyof ReportExportData["segmentos"]>) {
    secao(`Segmento · ${LABEL_SEGMENTO[chave]}`, CAB_SEGMENTO, linhasSegmento(data.segmentos[chave]))
  }

  doc.save(nomeArquivo(data.periodo, "pdf"))
}

// ---------------------------------------------------------------------------
// JSON — dump completo dos dados já carregados (mesmo recorte da tela).
// ---------------------------------------------------------------------------

export function exportReportToJson(data: ReportExportData): void {
  const payload = {
    exportadoEm: new Date().toISOString(),
    periodo: data.periodo,
    funil: data.funil,
    melhorMomento: { diaSemana: data.diaSemana, horario: data.horario },
    campanhas: data.campanhas,
    mensagens: data.mensagens,
    segmentos: data.segmentos,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  baixarBlob(blob, nomeArquivo(data.periodo, "json"))
}
