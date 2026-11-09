import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { AnalysisBridge, AnalysisDetail, SourceResult } from '../../refinement/analysis-types.js';
import { LoadGate } from '../components/load-gate.js';
import { SourceResults } from '../components/source-results.js';
import { SourcesForm, type SourcesField } from '../components/sources-form.js';
import { useLoad } from '../components/use-load.js';
import { ANALYSIS_TEXTS as T, COLORS, KEYS } from '../texts.js';

interface AnalysisScreenProps {
  id: string;
  analysis: AnalysisBridge;
  onBack: () => void;
}

const ADD_FIELDS: readonly SourcesField[] = ['paths', 'text'];

type Step =
  | { name: 'view' }
  | { name: 'add'; error: string | null }
  | { name: 'saving' }
  | { name: 'results'; results: SourceResult[] };

// Destino provisional de entrar a un análisis (10B-1): sus fuentes y su tarea. 10B-2 lo reemplaza por el chat
export function AnalysisScreen({ id, analysis, onBack }: AnalysisScreenProps) {
  const { state, retry } = useLoad(() => analysis.load(id));
  return (
    <LoadGate state={state} loadingText={T.loading} onRetry={retry} onBack={onBack}>
      {(detail) => <AnalysisView detail={detail} analysis={analysis} reload={retry} onBack={onBack} />}
    </LoadGate>
  );
}

interface AnalysisViewProps {
  detail: AnalysisDetail;
  analysis: AnalysisBridge;
  reload: () => void;
  onBack: () => void;
}

function AnalysisView({ detail, analysis, reload, onBack }: AnalysisViewProps) {
  const [step, setStep] = useState<Step>({ name: 'view' });

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      else if (input === KEYS.addSources) setStep({ name: 'add', error: null });
    },
    { isActive: step.name === 'view' },
  );

  if (step.name === 'saving') return <Text>{T.saving}</Text>;
  if (step.name === 'results') {
    return (
      <SourceResults
        title={T.added}
        results={step.results}
        onContinue={() => {
          // Releer el análisis: la lista de fuentes ya incluye lo agregado
          setStep({ name: 'view' });
          reload();
        }}
      />
    );
  }
  if (step.name === 'add') {
    return (
      <SourcesForm
        title={T.addTitle}
        fields={ADD_FIELDS}
        error={step.error}
        onCancel={() => setStep({ name: 'view' })}
        onSubmit={async (values) => {
          setStep({ name: 'saving' });
          const outcome = await analysis
            .addSources(detail.id, { paths: values.paths, text: values.text })
            .catch((err: unknown) => ({ ok: false as const, message: (err as Error).message }));
          if (outcome.ok) setStep({ name: 'results', results: outcome.results });
          else setStep({ name: 'add', error: outcome.message });
        }}
      />
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {T.title(detail.id, detail.name)}
      </Text>
      <Text>{T.sourcesTitle(detail.sources.length)}</Text>
      {detail.sources.length === 0 && <Text color={COLORS.muted}>{T.noSourcesYet}</Text>}
      {detail.sources.map((source) => (
        <Text key={source.file}>{T.sourceLine(source.file, source.origin === 'text')}</Text>
      ))}
      <Text>{T.trackingTitle}</Text>
      {detail.tracking.length === 0 && <Text color={COLORS.muted}>{T.noTracking}</Text>}
      {detail.tracking.map((task) => (
        <Text key={task.issueKey}>{T.trackingLine(task.issueKey, T.trackingStatus[task.status])}</Text>
      ))}
      <Text color={COLORS.muted}>{T.nextStep}</Text>
      <Text color={COLORS.muted}>{T.detailHint}</Text>
    </Box>
  );
}
