import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
// Solo tipos: se borra al compilar
import type {
  PlanningInput,
  PlanningOutcome,
  PlanningStatus,
  PlanningSuggestion,
  TasksBridge,
} from '../../refinement/tasks-types.js';
import type { BrowseItem } from '../../refinement/types.js';
import { EpicPicker } from '../components/epic-picker.js';
import { ManualKeyInput } from '../components/manual-key-input.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { ANALYSIS_TEXTS, COLORS, MANAGEMENT_TEXTS, PLANNING_TEXTS as T } from '../texts.js';

// Sigue al chat (o al análisis): con un aviso para mostrar y la tarea abierta (para preguntar al salir), si las hay
type OnDone = (notice: string | null, taskKey: string | null) => void;

type Field = 'estimate' | 'dueDate';
const FIELD_ORDER: Field[] = ['estimate', 'dueDate'];
// Sin sugerencia los campos quedan vacíos: el dev escribe la estimación y la fecha vacía se crea con hoy
const NO_SUGGESTION: PlanningSuggestion = { estimate: '', dueDate: '', measured: 0 };

type Step =
  | { name: 'checking' }
  | { name: 'ask' }
  | { name: 'where' }
  | { name: 'manual' }
  | { name: 'suggesting' }
  | { name: 'form' }
  | { name: 'creating' }
  | { name: 'failed'; message: string };

// De dónde salen los datos de la tarea: una historia (Planificación) o un análisis sin historia
export interface PlanningFlowSource {
  status: () => Promise<PlanningStatus>;
  suggest: () => Promise<PlanningSuggestion>;
  // whereKey: destino elegido a mano; null = el de siempre (gestión o la misma historia)
  create: (input: PlanningInput, whereKey: string | null) => Promise<PlanningOutcome>;
}

export interface PlanningFlowLabels {
  question: string;
  why: string;
  formTitle: string;
  continueHint: string;
  stillOpen: (key: string) => string;
  created: (key: string) => string;
  createdNotStarted: (key: string) => string;
}

// Solo el análisis sin historia pregunta dónde: no hay una historia donde caer por defecto
export interface PlanningWhere {
  fetchEpics: () => Promise<BrowseItem[]>;
}

interface PlanningFlowProps {
  source: PlanningFlowSource;
  labels: (managementKey: string | null) => PlanningFlowLabels;
  where?: PlanningWhere;
  onDone: OnDone;
}

// Sin IA: ¿registro la tarea? Un fallo nunca impide seguir adelante
export function PlanningFlow({ source, labels, where, onDone }: PlanningFlowProps) {
  const [step, setStep] = useState<Step>({ name: 'checking' });
  const [suggestion, setSuggestion] = useState<PlanningSuggestion>(NO_SUGGESTION);
  const [values, setValues] = useState<Record<Field, string>>({ estimate: '', dueDate: '' });
  const [focus, setFocus] = useState(0);
  // Dónde irá la tarea: null = en la misma historia
  const [managementKey, setManagementKey] = useState<string | null>(null);
  const [whereKey, setWhereKey] = useState<string | null>(null);
  const [whereProblem, setWhereProblem] = useState<string | null>(null);
  const [formFilled, setFormFilled] = useState(false);
  const text = labels(managementKey);

  useEffect(() => {
    let alive = true;
    source
      .status()
      .then((status) => {
        if (!alive) return;
        if (status.open) onDone(labels(status.managementKey).stillOpen(status.open), status.open);
        else {
          setManagementKey(status.managementKey);
          setStep({ name: 'ask' });
        }
      })
      // Sin poder leer el estado no se pregunta: quien sigue reporta el problema al abrir
      .catch(() => alive && onDone(null, null));
    return () => {
      alive = false;
    };
    // Solo al entrar
  }, []);

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
    const value = await source.suggest().catch(() => NO_SUGGESTION);
    setSuggestion(value);
    setValues({ estimate: value.estimate, dueDate: value.dueDate });
    setFormFilled(true);
    setStep({ name: 'form' });
  };

  const accept = () => {
    if (where && !managementKey) setStep({ name: 'where' });
    else void openForm();
  };

  const chooseWhere = (key: string) => {
    setWhereKey(key);
    setWhereProblem(null);
    // Si ya tecleó la estimación (el destino falló), no se la pedimos otra vez
    if (formFilled) setStep({ name: 'form' });
    else void openForm();
  };

  const create = async () => {
    setStep({ name: 'creating' });
    const outcome = await source
      .create(values, whereKey)
      .catch((err: unknown): PlanningOutcome => ({ ok: false, message: (err as Error).message }));
    if (outcome.ok) {
      const created = outcome.started ? text.created(outcome.issueKey) : text.createdNotStarted(outcome.issueKey);
      const { fallback } = outcome;
      const warning = fallback ? ` ${MANAGEMENT_TEXTS.fallback(fallback.key, fallback.reason, fallback.message)}` : '';
      onDone(`${created}${warning}`, outcome.issueKey);
    } else if (outcome.askWhere && where) {
      setWhereKey(null);
      setWhereProblem(outcome.message);
      setStep({ name: 'where' });
    } else setStep({ name: 'failed', message: outcome.message });
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
        <Text color={COLORS.muted}>{text.continueHint}</Text>
      </Box>
    );
  }
  if (step.name === 'manual') {
    return <ManualKeyInput onSubmit={chooseWhere} onCancel={() => setStep({ name: 'where' })} />;
  }
  if (step.name === 'where' && where) {
    const W = ANALYSIS_TEXTS.tracking;
    return (
      <Box flexDirection="column">
        {whereProblem && <Text color={COLORS.error}>{W.whereProblem(whereProblem)}</Text>}
        <EpicPicker
          texts={{ title: W.whereTitle, empty: W.whereEmpty, nextStep: W.whereNextStep, hint: W.whereHint }}
          fetchEpics={where.fetchEpics}
          onChoose={chooseWhere}
          onManual={() => setStep({ name: 'manual' })}
          onBack={() => onDone(null, null)}
        />
      </Box>
    );
  }
  if (step.name === 'ask') {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.muted}>{text.why}</Text>
        <YesNoPrompt question={text.question} onYes={accept} onNo={() => onDone(null, null)} />
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {text.formTitle}
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

interface PlanningScreenProps {
  storyKey: string;
  tasks: TasksBridge;
  onDone: OnDone;
}

// Antes del chat: ¿registro una Planificación en la historia?
export function PlanningScreen({ storyKey, tasks, onDone }: PlanningScreenProps) {
  const source: PlanningFlowSource = {
    status: () => tasks.planningStatus(storyKey),
    suggest: () => tasks.planningSuggestion(),
    create: (input) => tasks.createPlanning(storyKey, input),
  };
  const labels = (managementKey: string | null): PlanningFlowLabels => ({
    question: T.question(storyKey, managementKey),
    why: managementKey ? T.whyManagement(managementKey, storyKey) : T.why,
    formTitle: T.formTitle(storyKey),
    continueHint: T.continueHint,
    stillOpen: T.stillOpen,
    created: T.created,
    createdNotStarted: T.createdNotStarted,
  });
  return <PlanningFlow key={storyKey} source={source} labels={labels} onDone={onDone} />;
}
