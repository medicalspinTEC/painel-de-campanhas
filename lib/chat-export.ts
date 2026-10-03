import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import { formatDateTime } from "@/lib/format"
import type { ChatExportItem } from "@/services/chat"

const REMETENTE: Record<string, string> = {
  lead: "Lead",
  equipe: "Equipe",
  interno: "Nota interna",
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

function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 40) || "conversa"
  )
}

function nomeArquivo(conversas: ChatExportItem[], extensao: string): string {
  const carimbo = new Date().toISOString().slice(0, 10)
  const base = conversas.length === 1 ? `chat-${slug(conversas[0].lead.nome)}` : `chats-${conversas.length}-conversas`
  return `${base}-${carimbo}.${extensao}`
}

/**
 * As fontes padrão do PDF só cobrem Latin-1/WinAnsi: emojis e símbolos fora
 * disso sairiam como lixo. Troca por "" o que não for suportado.
 */
function textoPdf(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‏‪-‮⁠︎️]/g, "")
    .replace(/[^\n\t\x20-\x7E -ÿ–—‘’“”•…€]/gu, "")
}

export function exportChatsToJson(conversas: ChatExportItem[]): void {
  const payload = {
    exportadoEm: new Date().toISOString(),
    totalConversas: conversas.length,
    totalMensagens: conversas.reduce((soma, c) => soma + c.mensagens.length, 0),
    conversas: conversas.map(({ lead, mensagens }) => ({
      lead,
      mensagens: mensagens.map((m) => ({
        id: m.id,
        remetente: m.lado === "lead" ? "lead" : m.lado === "equipe" ? "equipe" : "nota_interna",
        texto: m.texto,
        data: m.data,
        campanha: m.campanhaNome,
      })),
    })),
  }
  baixarBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), nomeArquivo(conversas, "json"))
}

export function exportChatsToPdf(conversas: ChatExportItem[]): void {
  const doc = new jsPDF()
  const largura = doc.internal.pageSize.getWidth()

  conversas.forEach(({ lead, mensagens }, indice) => {
    if (indice > 0) doc.addPage()

    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.text(textoPdf(lead.nome) || "Lead", 14, 16)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(90)

    const detalhes = [
      `Telefone: ${lead.telefone}`,
      `Status: ${lead.status.replaceAll("_", " ")}`,
      lead.campanhas.length ? `Campanhas: ${lead.campanhas.join(", ")}` : null,
      `Produto: ${lead.produto} · Marca: ${lead.marca} · Persona: ${lead.persona} · Região: ${lead.regiao}`,
    ].filter((linha): linha is string => Boolean(linha))
    const linhasDetalhe = doc.splitTextToSize(textoPdf(detalhes.join("\n")), largura - 28) as string[]
    doc.text(linhasDetalhe, 14, 22)
    doc.setTextColor(0)

    autoTable(doc, {
      startY: 22 + linhasDetalhe.length * 4.2 + 3,
      head: [["Data e hora", "Remetente", "Mensagem"]],
      body: mensagens.length
        ? mensagens.map((m) => [formatDateTime(m.data), REMETENTE[m.lado] ?? m.lado, textoPdf(m.texto) || "(sem texto)"])
        : [["—", "—", "Nenhuma mensagem nesta conversa."]],
      styles: { fontSize: 8, cellPadding: 1.8, valign: "top" },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 24 }, 2: { cellWidth: "auto" } },
      margin: { top: 16, bottom: 16 },
      didParseCell: (dados) => {
        if (dados.section !== "body") return
        const lado = mensagens[dados.row.index]?.lado
        if (lado === "equipe") dados.cell.styles.fillColor = [220, 248, 198]
        else if (lado === "interno") dados.cell.styles.fillColor = [254, 243, 199]
      },
    })

  })

  const paginas = doc.getNumberOfPages()
  const altura = doc.internal.pageSize.getHeight()
  for (let pagina = 1; pagina <= paginas; pagina++) {
    doc.setPage(pagina)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`Exportado em ${formatDateTime(new Date())}`, 14, altura - 8)
    doc.text(`Página ${pagina} de ${paginas}`, largura - 14, altura - 8, { align: "right" })
  }

  doc.save(nomeArquivo(conversas, "pdf"))
}
