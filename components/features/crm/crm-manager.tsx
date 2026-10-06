"use client"

import { Building2, Headset } from "lucide-react"

import { AtendentesPanel } from "@/components/features/crm/atendentes-panel"
import { DepartamentosPanel } from "@/components/features/crm/departamentos-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CrmData } from "@/services/crm"

export function CrmManager({
  dados,
  chatAtivo,
  usuarioAtualId,
  ehRoot,
  podeEditarNoCode,
}: {
  dados: CrmData
  chatAtivo: boolean
  usuarioAtualId: string
  /** Só o Root pode criar/promover administradores. */
  ehRoot: boolean
  /** Seção No Code liberada e plugin ativo: só então o link do editor dos bots aparece. */
  podeEditarNoCode: boolean
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
      </TabsList>

      <TabsContent value="departamentos">
        <DepartamentosPanel
          departamentos={dados.departamentos}
          botsEntrada={dados.botsEntrada}
          chatAtivo={chatAtivo}
          podeEditarNoCode={podeEditarNoCode}
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
    </Tabs>
  )
}
