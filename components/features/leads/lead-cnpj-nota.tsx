"use client"

import { useState, useTransition } from "react"
import { Building2, Landmark, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"

import { consultarCnpjLeadAction } from "@/app/actions/leads"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { cnpjMascara, enderecoEmUmaLinha, type CnpjDados } from "@/lib/cnpj"
import { formatDateTime } from "@/lib/format"

const REAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  if (!valor) return null
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted-foreground sm:w-44 sm:shrink-0">{rotulo}</dt>
      <dd className="text-sm font-medium break-words">{valor}</dd>
    </div>
  )
}

function Regime({ rotulo, r }: { rotulo: string; r: CnpjDados["simples"] }) {
  if (r.optante === null) return null
  const detalhe = r.optante
    ? r.dataOpcao
      ? `Optante desde ${r.dataOpcao}`
      : "Optante"
    : r.dataExclusao
      ? `Não optante (excluído em ${r.dataExclusao})`
      : "Não optante"
  return <Linha rotulo={rotulo} valor={detalhe} />
}

function situacaoVariante(situacao: string): "default" | "secondary" | "destructive" | "outline" {
  const s = situacao.toUpperCase()
  if (s === "ATIVA") return "default"
  if (s === "SUSPENSA" || s === "INAPTA") return "secondary"
  if (s === "BAIXADA" || s === "NULA") return "destructive"
  return "outline"
}

/** Dados estruturados da consulta, como nota do lead. */
export function CnpjDadosView({ dados }: { dados: CnpjDados }) {
  const endereco = enderecoEmUmaLinha(dados.endereco)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {dados.situacao ? <Badge variant={situacaoVariante(dados.situacao)}>{dados.situacao}</Badge> : null}
        {dados.tipo ? <Badge variant="outline">{dados.tipo}</Badge> : null}
        {dados.porte ? <Badge variant="outline">{dados.porte}</Badge> : null}
      </div>

      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Building2 className="size-4 text-primary" />
          Empresa
        </h4>
        <dl className="flex flex-col gap-1.5">
          <Linha rotulo="Razão social" valor={dados.nome} />
          <Linha rotulo="Nome fantasia" valor={dados.fantasia} />
          <Linha rotulo="CNPJ" valor={dados.cnpj} />
          <Linha rotulo="Abertura" valor={dados.abertura} />
          <Linha rotulo="Natureza jurídica" valor={dados.naturezaJuridica} />
          <Linha rotulo="Capital social" valor={dados.capitalSocial !== null ? REAL.format(dados.capitalSocial) : null} />
          <Linha
            rotulo="Situação cadastral"
            valor={[dados.situacao, dados.dataSituacao ? `desde ${dados.dataSituacao}` : ""].filter(Boolean).join(" ")}
          />
          <Linha rotulo="Motivo da situação" valor={dados.motivoSituacao} />
          <Linha rotulo="Situação especial" valor={dados.situacaoEspecial} />
          <Regime rotulo="Simples Nacional" r={dados.simples} />
          <Regime rotulo="MEI (SIMEI)" r={dados.simei} />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Contato e endereço</h4>
        <dl className="flex flex-col gap-1.5">
          <Linha rotulo="Endereço" valor={endereco} />
          <Linha rotulo="E-mail" valor={dados.email} />
          <Linha rotulo="Telefone" valor={dados.telefone} />
        </dl>
      </section>

      {dados.atividadePrincipal.length > 0 || dados.atividadesSecundarias.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Atividades (CNAE)</h4>
          {dados.atividadePrincipal.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Principal</span>
              <ul className="flex flex-col gap-1 text-sm">
                {dados.atividadePrincipal.map((a) => (
                  <li key={a.codigo}>
                    <span className="font-mono text-xs text-muted-foreground">{a.codigo}</span> {a.texto}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {dados.atividadesSecundarias.length > 0 ? (
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Secundárias ({dados.atividadesSecundarias.length})
              </summary>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {dados.atividadesSecundarias.map((a) => (
                  <li key={a.codigo}>
                    <span className="font-mono text-xs text-muted-foreground">{a.codigo}</span> {a.texto}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {dados.socios.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Quadro societário</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {dados.socios.map((s) => (
              <li key={`${s.nome}-${s.qualificacao}`} className="flex flex-col sm:flex-row sm:gap-2">
                <span className="font-medium">{s.nome}</span>
                {s.qualificacao ? <span className="text-muted-foreground">{s.qualificacao}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * Nota do CNPJ nos detalhes do lead (plugin CRM). A consulta na Receita é manual: só acontece
 * quando o usuário clica em "Consultar CNPJ" (ou "Consultar novamente" para atualizar a nota).
 */
export function LeadCnpjNota({
  leadId,
  cnpj,
  dadosIniciais,
  consultadoEmInicial,
}: {
  leadId: string
  cnpj: string | null
  dadosIniciais: CnpjDados | null
  consultadoEmInicial: string | null
}) {
  const [dados, setDados] = useState<CnpjDados | null>(dadosIniciais)
  const [consultadoEm, setConsultadoEm] = useState<string | null>(consultadoEmInicial)
  const [pendente, iniciar] = useTransition()

  function consultar() {
    iniciar(async () => {
      const resultado = await consultarCnpjLeadAction(leadId)
      if (resultado.ok) {
        setDados(resultado.dados)
        setConsultadoEm(resultado.consultadoEm)
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  // A página recarrega os dados quando o CNPJ do lead muda; aqui só reflete o que veio do servidor.
  const dadosAtuais = cnpj ? dados : null

  if (!cnpj) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Landmark />
          </EmptyMedia>
          <EmptyTitle>Sem CNPJ cadastrado</EmptyTitle>
          <EmptyDescription>
            Informe o CNPJ ao editar o lead (em Leads). Depois, volte aqui para consultar os dados na Receita Federal.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">CNPJ do lead</span>
          <span className="font-mono text-sm font-medium">{cnpjMascara(cnpj)}</span>
        </div>
        <Button size="sm" variant={dadosAtuais ? "outline" : "default"} onClick={consultar} disabled={pendente}>
          {pendente ? <Spinner /> : dadosAtuais ? <RefreshCw className="size-4" /> : <Search className="size-4" />}
          {dadosAtuais ? "Consultar novamente" : "Consultar CNPJ"}
        </Button>
      </div>

      {dadosAtuais ? (
        <>
          <CnpjDadosView dados={dadosAtuais} />
          <p className="text-xs text-muted-foreground">
            Fonte: Receita Federal, via ReceitaWS.
            {consultadoEm ? ` Consultado em ${formatDateTime(consultadoEm)}.` : ""}
            {dadosAtuais.ultimaAtualizacao ? ` Base atualizada em ${formatDateTime(dadosAtuais.ultimaAtualizacao)}.` : ""}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ainda não consultado. Clique em “Consultar CNPJ” para trazer os dados da Receita Federal para esta nota.
        </p>
      )}
    </div>
  )
}
