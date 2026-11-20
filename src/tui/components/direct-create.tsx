import React, { useEffect } from 'react';
import { Text } from 'ink';
import type { CreateOutcome, PlanBridge } from '../../refinement/review-types.js';
import { AFTER_CHAT_TEXTS, CREATE_TEXTS } from '../texts.js';

// review: falta una decisión del dev (padre, vínculos) y se abre la revisión en vez de crear a ciegas
export interface DirectCreateResult {
  notice: string;
  review: boolean;
}

interface DirectCreateProps {
  storyKey: string;
  plan: PlanBridge;
  onDone: (result: DirectCreateResult) => void;
}

const reviewResult = (notice: string): DirectCreateResult => ({ notice, review: true });
// Crear desde aquí no muestra el avance por tarea: solo el aviso al terminar
const ignoreProgress = (): void => undefined;
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function describeOutcome(storyKey: string, outcome: CreateOutcome): DirectCreateResult {
  if (outcome.ok) {
    const created = AFTER_CHAT_TEXTS.created(outcome.created.length, outcome.parentKey);
    return { notice: outcome.estimateSkipped ? `${created}. ${CREATE_TEXTS.estimateSkipped}` : created, review: false };
  }
  return { notice: AFTER_CHAT_TEXTS.failed(storyKey, outcome.message, outcome.created.length), review: false };
}

// Crea con los valores por defecto de la pantalla de crear (c + confirmar), sin pasar por ella
async function createWithDefaults(plan: PlanBridge, storyKey: string): Promise<DirectCreateResult> {
  const preview = await plan.prepareCreate(storyKey);
  if (preview.parent.kind !== 'ready') return reviewResult(AFTER_CHAT_TEXTS.needsParent(storyKey));
  if (preview.existing.length > 0) return reviewResult(AFTER_CHAT_TEXTS.hasExisting(storyKey));
  if (preview.taskCount === 0) return reviewResult(AFTER_CHAT_TEXTS.noTasks(storyKey));
  const outcome = await plan.create(
    storyKey,
    { target: preview.parent.target, assigneeId: preview.assignee.accountId, adopt: {} },
    ignoreProgress,
  );
  return describeOutcome(storyKey, outcome);
}

export function DirectCreate({ storyKey, plan, onDone }: DirectCreateProps) {
  // Una sola creación al montar: la pantalla se desmonta al terminar y no debe repetirse si cambian las props
  useEffect(() => {
    let cancelled = false;
    createWithDefaults(plan, storyKey)
      .catch((err: unknown) => describeOutcome(storyKey, { ok: false, message: errorText(err), created: [] }))
      .then((result) => {
        if (!cancelled) onDone(result);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <Text>{AFTER_CHAT_TEXTS.creating(storyKey)}</Text>;
}
