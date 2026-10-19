"use client"

import { Building2, Filter, Headset } from "lucide-react"

import { AtendentesPanel } from "@/components/features/crm/atendentes-panel"
import { DepartamentosPanel } from "@/components/features/crm/departamentos-panel"
import { FunisPanel } from "@/components/features/crm/funis-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { FunilBoardData, FunilResumo } from "@/lib/funis"
import type { CrmData } from "@/services/crm"
import type { FollowUpBotItem } from "@/services/followup"

export function CrmManager({
  dados,
  followUpBots,
  funis,
  funilBoardInicial,
  chatAtivo,
  usuarioAtualId,
  ehRoot,
  podeEditarNoCode,
  podeAbrirAgentes,
}: {
  dados: CrmData
  /** Bots de follow-up (um por departamento). */
  followUpBots: FollowUpBotItem[]
  /** Funis de vendas e o quadro do primeiro funil (os demais são carregados ao selecionar). */
  funis: FunilResumo[]
  funilBoardInicial: FunilBoardData | null
  chatAtivo: boolean
  usuarioAtualId: string
  /** Só o Root pode criar/promover administradores. */
  ehRoot: boolean
  /** Seção No Code liberada e plugin ativo: só então o link do editor dos bots aparece. */
  podeEditarNoCode: boolean
  /** Seção Agentes de IA liberada para o usuário (atalho para criar/editar agentes). */
  podeAbrirAgentes: boolean
}) {
  return (
    <Tabs defaultValue="departamentos">
      <TabsList>
        <TabsTrigger value="departamentos">
          <Building2 className="size-4" />
          Departamentos
        </TabsTrigger>
        <TabsTrigger value="atendentes">
          <Headset className="size-4" />
          Atendentes
        </TabsTrigger>
        <TabsTrigger value="funis">
          <Filter className="size-4" />
          Funis
        </TabsTrigger>
      </TabsList>

      <TabsContent value="departamentos">
        <DepartamentosPanel
          departamentos={dados.departamentos}
          botsEntrada={dados.botsEntrada}
          followUpBots={followUpBots}
          chatAtivo={chatAtivo}
          podeEditarNoCode={podeEditarNoCode}
          agentesIaAtivo={dados.agentesIaAtivo}
          agentesIa={dados.agentesIa}
          agenteIaEntradaId={dados.agenteIaEntradaId}
          podeAbrirAgentes={podeAbrirAgentes}
        />
      </TabsContent>
      <TabsContent value="atendentes">
        <AtendentesPanel
          atendentes={dados.atendentes}
          departamentos={dados.departamentos}
          usuariosDisponiveis={dados.usuariosDisponiveis}
          chatAtivo={chatAtivo}
          usuarioAtualId={usuarioAtualId}
          ehRoot={ehRoot}
        />
      </TabsContent>
      <TabsContent value="funis">
        <FunisPanel funis={funis} boardInicial={funilBoardInicial} />
      </TabsContent>
    </Tabs>
  )
}
