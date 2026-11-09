import React, { useState } from 'react';
import { Text } from 'ink';
// Solo tipos: se borra al compilar
import type { AnalysisBridge, SourceResult } from '../../refinement/analysis-types.js';
import { SourceResults } from '../components/source-results.js';
import { SourcesForm, type SourcesField } from '../components/sources-form.js';
import { ANALYSIS_TEXTS as T } from '../texts.js';

interface NewAnalysisScreenProps {
  analysis: AnalysisBridge;
  // Sale con el análisis ya creado (o sin él si canceló)
  onDone: () => void;
}

const FIELDS: readonly SourcesField[] = ['name', 'paths', 'text'];

type Step =
  | { name: 'form'; error: string | null }
  | { name: 'saving' }
  | { name: 'results'; id: string; label: string; results: SourceResult[] };

// Desde el inicio: nombre y fuentes de un análisis sin historia
export function NewAnalysisScreen({ analysis, onDone }: NewAnalysisScreenProps) {
  const [step, setStep] = useState<Step>({ name: 'form', error: null });

  if (step.name === 'saving') return <Text>{T.saving}</Text>;
  if (step.name === 'results') {
    return <SourceResults title={T.created(step.id, step.label)} results={step.results} onContinue={onDone} />;
  }
  return (
    <SourcesForm
      title={T.newTitle}
      fields={FIELDS}
      error={step.error}
      onCancel={onDone}
      onSubmit={async (values) => {
        setStep({ name: 'saving' });
        const outcome = await analysis
          .create(values)
          .catch((err: unknown) => ({ ok: false as const, message: (err as Error).message }));
        if (outcome.ok)
          setStep({ name: 'results', id: outcome.id, label: values.name.trim(), results: outcome.results });
        else setStep({ name: 'form', error: outcome.message });
      }}
    />
  );
}
