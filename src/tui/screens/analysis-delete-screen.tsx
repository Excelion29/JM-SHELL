import React, { useState } from 'react';
import { Box, Text } from 'ink';
// Solo tipos: se borra al compilar
import type { AnalysisBridge, AnalysisDetail } from '../../refinement/analysis-types.js';
import { LoadGate } from '../components/load-gate.js';
import { TypedConfirm } from '../components/task-prompts.js';
import { useLoad } from '../components/use-load.js';
import { ANALYSIS_TEXTS, COLORS } from '../texts.js';

const T = ANALYSIS_TEXTS.remove;

interface AnalysisDeleteScreenProps {
  id: string;
  analysis: AnalysisBridge;
  // Siempre vuelve al inicio; message es el aviso (borrado, motivo del fallo o nada si se canceló)
  onDone: (message: string | null) => void;
}

// Confirmación escrita para borrar un análisis libre: se llega con x o Supr en el inicio
export function AnalysisDeleteScreen({ id, analysis, onDone }: AnalysisDeleteScreenProps) {
  const { state, retry } = useLoad(() => analysis.load(id));
  return (
    <LoadGate state={state} loadingText={T.loading} onRetry={retry} onBack={() => onDone(null)}>
      {(detail) => <DeleteConfirm detail={detail} analysis={analysis} onDone={onDone} />}
    </LoadGate>
  );
}

interface DeleteConfirmProps {
  detail: AnalysisDetail;
  analysis: AnalysisBridge;
  onDone: (message: string | null) => void;
}

function DeleteConfirm({ detail, analysis, onDone }: DeleteConfirmProps) {
  const [deleting, setDeleting] = useState(false);
  if (deleting) return <Text>{T.deleting}</Text>;

  const confirm = async () => {
    setDeleting(true);
    const outcome = await analysis
      .remove(detail.id)
      .catch((err: unknown) => ({ ok: false as const, message: (err as Error).message }));
    onDone(outcome.ok ? T.done(detail.id) : outcome.message);
  };

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.code}>
        {T.title(detail.id, detail.name)}
      </Text>
      <Text>{T.sources(detail.sources.length)}</Text>
      <Text>{T.documents(detail.documented)}</Text>
      <Text color={COLORS.muted}>{T.scope}</Text>
      <TypedConfirm
        prompt={T.prompt}
        onConfirm={() => void confirm()}
        onMismatch={() => onDone(T.mismatch)}
        onCancel={() => onDone(null)}
      />
    </Box>
  );
}
