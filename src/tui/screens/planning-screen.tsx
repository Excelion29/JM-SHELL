import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
// Solo tipos: se borra al compilar
import type { PlanningSuggestion, TasksBridge } from '../../refinement/tasks-types.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { COLORS, MANAGEMENT_TEXTS, PLANNING_TEXTS as T } from '../texts.js';

interface PlanningScreenProps {
  storyKey: string;
  tasks: TasksBridge;
  // Sigue al chat: con un aviso para mostrar y la Planificación abierta (para preguntar al salir), si las hay
  onDone: (notice: string | null, planningKey: string | null) => void;
}

type Field = 'estimate' | 'dueDate';
const FIELD_ORDER: Field[] = ['estimate', 'dueDate'];
// Sin sugerencia los campos quedan vacíos: el dev escribe la estimación y la fecha vacía se crea con hoy
const NO_SUGGESTION: PlanningSuggestion = { estimate: '', dueDate: '', measured: 0 };

type Step =
  | { name: 'checking' }
  | { name: 'ask' }
  | { name: 'suggesting' }
  | { name: 'form' }
  | { name: 'creating' }
  | { name: 'failed'; message: string };

// Antes del chat, sin IA: ¿registro una Planificación? Un fallo nunca impide entrar al chat
export function PlanningScreen({ storyKey, tasks, onDone }: PlanningScreenProps) {
  const [step, setStep] = useState<Step>({ name: 'checking' });
  const [suggestion, setSuggestion] = useState<PlanningSuggestion>(NO_SUGGESTION);
  const [values, setValues] = useState<Record<Field, string>>({ estimate: '', dueDate: '' });
  const [focus, setFocus] = useState(0);
  // Dónde irá la tarea: null = en la misma historia
  const [managementKey, setManagementKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    tasks
      .planningStatus(storyKey)
      .then((status) => {
        if (!alive) return;
        if (status.open) onDone(T.stillOpen(status.open), status.open);
        else {
          setManagementKey(status.managementKey);
          setStep({ name: 'ask' });
        }
      })
      // Sin poder leer la historia no se pregunta: el chat reporta el problema al abrir
      .catch(() => alive && onDone(null, null));
    return () => {
      alive = false;
    };
    // Solo al entrar a la historia
  }, [storyKey]);

  useInput(
    (_input, key) => {
      if (step.name === 'failed') {
        if (key.return || key.escape) onDone(null, null);
        return;
      }
      if (key.escape) onDone(null, null);
      else if (key.upArrow) setFocus((i) => Math.max(0, i - 1));
      else if (key.downArrow || key.tab) setFocus((i) => Math.min(FIELD_ORDER.length - 1, i + 1));
    },
    { isActive: step.name === 'form' || step.name === 'failed' },
  );

  // La sugerencia solo se calcula si el dev decide registrarla
  const openForm = async () => {
    setStep({ name: 'suggesting' });
    const value = await tasks.planningSuggestion().catch(() => NO_SUGGESTION);
    setSuggestion(value);
    setValues({ estimate: value.estimate, dueDate: value.dueDate });
    setStep({ name: 'form' });
  };

  const create = async () => {
    setStep({ name: 'creating' });
    const outcome = await tasks
      .createPlanning(storyKey, values)
      .catch((err: unknown) => ({ ok: false as const, message: (err as Error).message }));
    if (!outcome.ok) setStep({ name: 'failed', message: outcome.message });
    else {
      const created = outcome.started ? T.created(outcome.issueKey) : T.createdNotStarted(outcome.issueKey);
      const { fallback } = outcome;
      const warning = fallback ? ` ${MANAGEMENT_TEXTS.fallback(fallback.key, fallback.reason, fallback.message)}` : '';
      onDone(`${created}${warning}`, outcome.issueKey);
    }
  };

  const submit = () => {
    if (focus < FIELD_ORDER.length - 1) setFocus(focus + 1);
    else if (values.estimate.trim()) void create();
  };

  if (step.name === 'checking') return <Text>{T.checking}</Text>;
  if (step.name === 'suggesting') return <Text>{T.suggesting}</Text>;
  if (step.name === 'creating') return <Text>{T.creating}</Text>;
  if (step.name === 'failed') {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.error}>{step.message}</Text>
        <Text color={COLORS.muted}>{T.continueHint}</Text>
      </Box>
    );
  }
  if (step.name === 'ask') {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.muted}>{managementKey ? T.whyManagement(managementKey, storyKey) : T.why}</Text>
        <YesNoPrompt
          question={T.question(storyKey, managementKey)}
          onYes={() => void openForm()}
          onNo={() => onDone(null, null)}
        />
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {T.formTitle(storyKey)}
      </Text>
      {FIELD_ORDER.map((field, index) => (
        <Box key={field}>
          <Text color={index === focus ? COLORS.brand : undefined}>{T.fields[field]}: </Text>
          <TextInput
            value={values[field]}
            focus={index === focus}
            onChange={(value) => setValues((v) => ({ ...v, [field]: value }))}
            onSubmit={submit}
          />
        </Box>
      ))}
      <Text color={COLORS.muted}>{T.suggested(suggestion.measured)}</Text>
      <Text color={COLORS.muted}>{T.formHint}</Text>
    </Box>
  );
}
