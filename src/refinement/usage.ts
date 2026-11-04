import { StoryUsage } from './types';

// Contexto de la última vuelta a partir del cual conviene seguir en una sesión nueva
export const SESSION_TOKEN_SOFT_LIMIT = 150_000;

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export const emptyTurnUsage = (): TurnUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

// Lo que entró a la ventana de contexto en la vuelta: entrada nueva + caché
export const contextTokensOf = (turn: TurnUsage): number =>
  turn.inputTokens + turn.cacheReadTokens + turn.cacheCreationTokens;

export const exceedsSoftLimit = (contextTokens: number): boolean => contextTokens >= SESSION_TOKEN_SOFT_LIMIT;

// La escritura de caché cuenta como entrada: es lo que se paga de más al crecer la conversación
export function addTurnUsage(total: StoryUsage, turn: TurnUsage, costUsd: number): StoryUsage {
  return {
    inputTokens: total.inputTokens + turn.inputTokens + turn.cacheCreationTokens,
    outputTokens: total.outputTokens + turn.outputTokens,
    cacheReadTokens: total.cacheReadTokens + turn.cacheReadTokens,
    costUsd: total.costUsd + costUsd,
    turns: total.turns + 1,
  };
}
