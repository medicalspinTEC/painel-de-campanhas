"use client"

import { Building2, MapPin, Package, UsersRound } from "lucide-react"

import {
  createMarcaAction,
  createPersonaAction,
  createRegiaoAction,
  deleteMarcaAction,
  deletePersonaAction,
  deleteRegiaoAction,
  updateMarcaAction,
  updatePersonaAction,
  updateRegiaoAction,
} from "@/app/actions/catalogo-segmentacao"
import { CatalogoManager, type CatalogoConfig } from "@/components/features/segmentacao/catalogo-manager"
import { ProdutosManager } from "@/components/features/segmentacao/produtos-manager"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ItemCatalogo } from "@/services/catalogo-segmentacao"
import type { Produto } from "@/services/produtos"

/** Contagens de uso (nº de leads por valor) para cada dimensão de segmentação. */
export interface ContagensSegmentacao {
  produtos: Record<string, number>
  marcas: Record<string, number>
  personas: Record<string, number>
  regioes: Record<string, number>
}

export function SegmentacaoTabs({
  produtos,
  marcas,
  personas,
  regioes,
  contagens,
}: {
  produtos: Produto[]
  marcas: ItemCatalogo[]
  personas: ItemCatalogo[]
  regioes: ItemCatalogo[]
  contagens: ContagensSegmentacao
}) {
  const configMarcas: CatalogoConfig = {
    singular: "marca",
    plural: "marcas",
    titulo: "Marcas",
    exemplo: "NovaVida",
    icon: Building2,
    onCreate: createMarcaAction,
    onUpdate: updateMarcaAction,
    onDelete: deleteMarcaAction,
  }

  const configPersonas: CatalogoConfig = {
    singular: "persona",
    plural: "personas",
    titulo: "Personas",
    exemplo: "Investidor",
    icon: UsersRound,
    onCreate: createPersonaAction,
    onUpdate: updatePersonaAction,
    onDelete: deletePersonaAction,
  }

  const configRegioes: CatalogoConfig = {
    singular: "região",
    plural: "regiões",
    titulo: "Regiões",
    exemplo: "Sudeste",
    icon: MapPin,
    onCreate: createRegiaoAction,
    onUpdate: updateRegiaoAction,
    onDelete: deleteRegiaoAction,
  }

  return (
    <Tabs defaultValue="produtos">
      <TabsList>
        <TabsTrigger value="produtos">
          <Package className="size-4" />
          Produtos
        </TabsTrigger>
        <TabsTrigger value="marcas">
          <Building2 className="size-4" />
          Marcas
        </TabsTrigger>
        <TabsTrigger value="personas">
          <UsersRound className="size-4" />
          Personas
        </TabsTrigger>
        <TabsTrigger value="regioes">
          <MapPin className="size-4" />
          Regiões
        </TabsTrigger>
      </TabsList>

      <TabsContent value="produtos">
        <ProdutosManager produtos={produtos} contagemLeads={contagens.produtos} />
      </TabsContent>
      <TabsContent value="marcas">
        <CatalogoManager itens={marcas} contagemLeads={contagens.marcas} config={configMarcas} />
      </TabsContent>
      <TabsContent value="personas">
        <CatalogoManager itens={personas} contagemLeads={contagens.personas} config={configPersonas} />
      </TabsContent>
      <TabsContent value="regioes">
        <CatalogoManager itens={regioes} contagemLeads={contagens.regioes} config={configRegioes} />
      </TabsContent>
    </Tabs>
  )
}
