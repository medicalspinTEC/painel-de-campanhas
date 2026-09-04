"use client"

import { useRef, useState, useTransition } from "react"
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from "lucide-react"
import { toast } from "sonner"
import * as XLSX from "xlsx"

import { importLeadsAction, type ImportLeadsResult, type LeadImportRow } from "@/app/actions/leads"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/** Colunas aceitas no arquivo e seus sinônimos (sem acento, minúsculas). */
const MAPA_COLUNAS: Record<keyof LeadImportRow, string[]> = {
  nome: ["nome", "nome completo", "lead"],
  telefone: ["telefone", "celular", "whatsapp", "fone", "numero", "número"],
  produto: ["produto"],
  marca: ["marca"],
  persona: ["persona"],
  regiao: ["regiao", "região", "regiao/uf", "uf"],
  notas: ["notas", "observacoes", "observações", "obs"],
  campanha: ["campanha", "campaign"],
}

/** Remove acentos e normaliza o cabeçalho para casar com o mapa de colunas. */
function normalizarChave(chave: string): string {
  return chave
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
}

/** Converte uma linha crua da planilha em uma `LeadImportRow` mapeada. */
function mapearLinha(linha: Record<string, unknown>): LeadImportRow {
  const normalizada: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(linha)) {
    normalizada[normalizarChave(chave)] = valor == null ? "" : String(valor).trim()
  }
  const resultado: LeadImportRow = {}
  for (const [campo, sinonimos] of Object.entries(MAPA_COLUNAS) as [keyof LeadImportRow, string[]][]) {
    const encontrado = sinonimos.map(normalizarChave).find((s) => normalizada[s] !== undefined)
    if (encontrado) resultado[campo] = normalizada[encontrado]
  }
  return resultado
}

const COLUNAS_MODELO = ["nome", "telefone", "produto", "marca", "persona", "regiao", "notas", "campanha"]

export function LeadsImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LeadImportRow[]>([])
  const [erroLeitura, setErroLeitura] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ImportLeadsResult | null>(null)
  const [pending, startTransition] = useTransition()

  function limpar() {
    setNomeArquivo(null)
    setLinhas([])
    setErroLeitura(null)
    setResultado(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  function fechar(aberto: boolean) {
    if (!aberto) limpar()
    onOpenChange(aberto)
  }

  async function lerArquivo(arquivo: File) {
    setErroLeitura(null)
    setResultado(null)
    try {
      const buffer = await arquivo.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const primeiraAba = workbook.SheetNames[0]
      if (!primeiraAba) {
        setErroLeitura("A planilha está vazia.")
        return
      }
      const cruas = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[primeiraAba], {
        defval: "",
        raw: false,
      })
      const mapeadas = cruas.map(mapearLinha).filter((linha) => Object.values(linha).some((valor) => valor && valor.length > 0))
      if (mapeadas.length === 0) {
        setErroLeitura("Nenhuma linha de dados encontrada. Verifique se há um cabeçalho com as colunas nome e telefone.")
        return
      }
      setNomeArquivo(arquivo.name)
      setLinhas(mapeadas)
    } catch (error) {
      console.log("[v0] Erro ao ler planilha:", error)
      setErroLeitura("Não foi possível ler o arquivo. Use um .xlsx, .xls ou .csv válido.")
    }
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0]
    if (arquivo) void lerArquivo(arquivo)
  }

  function baixarModelo() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      COLUNAS_MODELO,
      ["Lead de Teste", "5511988887777", "ID", "ID", "ID", "ID", "ID", "ID"],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leads")
    XLSX.writeFile(workbook, "modelo-importacao-leads.xlsx")
  }

  function importar() {
    if (linhas.length === 0) return
    startTransition(async () => {
      const res = await importLeadsAction(linhas)
      setResultado(res)
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
    })
  }

  const preview = linhas.slice(0, 100)

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar leads via Excel</DialogTitle>
          <DialogDescription>
            Envie um arquivo .xlsx, .xls ou .csv. A primeira linha deve conter os cabeçalhos das colunas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Colunas reconhecidas</p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">nome</strong> e{" "}
              <strong className="text-foreground">telefone</strong> são obrigatórios. Opcionais: produto, marca,
              persona, regiao, notas e campanha. Nos campos de segmentação você pode informar o nome ou o
              ID de importação cadastrado na aba Segmentação. Na coluna campanha use o{" "}
              <strong className="text-foreground">ID de importação</strong> da campanha (o número mostrado na
              página Campanhas) ou o nome exato dela. O telefone deve incluir o país 55 (ex.: 5511988887777).
            </p>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={baixarModelo}>
                <Download className="size-4" />
                Baixar modelo
              </Button>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={onFileChange}
          />

          {!nomeArquivo ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary hover:bg-primary/5"
            >
              <Upload className="size-6 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">Clique para selecionar um arquivo</span>
              <span className="text-xs text-muted-foreground">.xlsx, .xls ou .csv</span>
            </button>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <FileSpreadsheet className="size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{nomeArquivo}</p>
                  <p className="text-xs text-muted-foreground">{linhas.length} linha(s) detectada(s)</p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={limpar} aria-label="Remover arquivo">
                <X className="size-4" />
              </Button>
            </div>
          )}

          {erroLeitura ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{erroLeitura}</span>
            </div>
          ) : null}

          {preview.length > 0 && !resultado ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Pré-visualização (primeiras {preview.length} linhas)</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead className="hidden sm:table-cell">Produto</TableHead>
                      <TableHead className="hidden sm:table-cell">Marca</TableHead>
                      <TableHead className="hidden md:table-cell">Persona</TableHead>
                      <TableHead className="hidden md:table-cell">Região</TableHead>
                      <TableHead className="hidden lg:table-cell">Notas</TableHead>
                      <TableHead className="hidden lg:table-cell">Campanha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((linha, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{linha.nome || "—"}</TableCell>
                        <TableCell className="tabular-nums">{linha.telefone || "—"}</TableCell>
                        <TableCell className="hidden sm:table-cell">{linha.produto || "—"}</TableCell>
                        <TableCell className="hidden sm:table-cell">{linha.marca || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{linha.persona || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{linha.regiao || "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell">{linha.notas || "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell">{linha.campanha || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {resultado ? (
            <div className="flex flex-col gap-3">
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  resultado.criados > 0
                    ? "border-primary/30 bg-primary/8 text-foreground"
                    : "border-destructive/30 bg-destructive/8 text-destructive"
                }`}
              >
                {resultado.criados > 0 ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <span>{resultado.message}</span>
              </div>

              {resultado.erros.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Linhas com erro</p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Linha</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead>Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resultado.erros.map((erro) => (
                          <TableRow key={erro.linha}>
                            <TableCell className="tabular-nums">{erro.linha}</TableCell>
                            <TableCell>{erro.nome}</TableCell>
                            <TableCell className="text-muted-foreground">{erro.motivo}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          {resultado ? (
            <Button type="button" onClick={() => fechar(false)}>
              Concluir
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => fechar(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={importar} disabled={pending || linhas.length === 0}>
                {pending ? <Spinner /> : <Upload className="size-4" />}
                Importar {linhas.length > 0 ? `${linhas.length} lead(s)` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
