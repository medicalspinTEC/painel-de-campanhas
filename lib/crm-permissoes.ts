/**
 * Regras de quem pode atuar numa conversa (plugin CRM). Função pura: roda no
 * servidor (para barrar de verdade) e no cliente (para mostrar/ocultar botões)
 * com o mesmo resultado.
 *
 * - Sem departamento e sem responsável: qualquer pessoa com acesso ao chat envia.
 * - Com responsável: só ele (ou admin) envia e transfere; os demais precisam que
 *   o responsável transfira a conversa.
 * - Com departamento e sem responsável: só atendentes vinculados ao departamento
 *   enviam, assumem e transferem.
 * - Notas internas nunca passam por aqui: todos podem adicionar.
 */

export type AtendimentoRef = {
  departamentoId: string | null
  atendenteId: string | null
  departamentoNome?: string | null
  atendenteNome?: string | null
}

export type ContextoAtendimento = {
  admin: boolean
  /** Perfil de atendente do usuário logado, se existir. */
  atendenteId: string | null
  /** Perfil de atendente ativo (inativo não recebe nem assume conversas). */
  atendenteAtivo: boolean
  /** Departamentos em que o usuário atende. */
  departamentoIds: string[]
}

export type PermissoesAtendimento = {
  podeEnviar: boolean
  podeAssumir: boolean
  podeTransferir: boolean
  /** Explica o bloqueio quando `podeEnviar` é falso. */
  motivo: string | null
}

export function avaliarAtendimento(
  atendimento: AtendimentoRef | null | undefined,
  ctx: ContextoAtendimento,
): PermissoesAtendimento {
  const departamentoId = atendimento?.departamentoId ?? null
  const atendenteId = atendimento?.atendenteId ?? null

  // Sem departamento nem responsável: livre para todos.
  if (!departamentoId && !atendenteId) {
    return { podeEnviar: true, podeAssumir: false, podeTransferir: true, motivo: null }
  }

  // Tem responsável: só ele (ou admin).
  if (atendenteId) {
    const ehResponsavel = ctx.atendenteId !== null && ctx.atendenteId === atendenteId
    if (ctx.admin || ehResponsavel) {
      return { podeEnviar: true, podeAssumir: false, podeTransferir: true, motivo: null }
    }
    const nome = atendimento?.atendenteNome ? ` (${atendimento.atendenteNome})` : ""
    return {
      podeEnviar: false,
      podeAssumir: false,
      podeTransferir: false,
      motivo: `Esta conversa já tem um responsável${nome}. Peça que ele transfira a conversa para você.`,
    }
  }

  // Departamento sem responsável.
  const podeAssumir = ctx.atendenteId !== null && ctx.atendenteAtivo && (ctx.admin || ctx.departamentoIds.includes(departamentoId!))
  const vinculado = ctx.atendenteAtivo && ctx.departamentoIds.includes(departamentoId!)
  if (ctx.admin || vinculado) {
    return { podeEnviar: true, podeAssumir, podeTransferir: true, motivo: null }
  }
  const nome = atendimento?.departamentoNome ? ` “${atendimento.departamentoNome}”` : ""
  return {
    podeEnviar: false,
    podeAssumir: false,
    podeTransferir: false,
    motivo: `Você não está vinculado ao departamento${nome}, então não pode assumir nem responder esta conversa. Você ainda pode adicionar notas internas.`,
  }
}
