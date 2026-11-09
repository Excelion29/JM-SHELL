import React from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { CalibrationModel, TasksBridge } from '../../refinement/tasks-types.js';
import { formatDuration, formatRatio, truncate } from '../components/duration.js';
import { LoadGate } from '../components/load-gate.js';
import { useLoad } from '../components/use-load.js';
import { CALIBRATION_TEXTS as T, COLORS, FOOTER_HINTS, KEYS, RISK_LABELS } from '../texts.js';

interface CalibrationScreenProps {
  tasks: TasksBridge;
  onBack: () => void;
}

const OUTLIER_TITLE_MAX = 40;

const ratioText = (ratio: number | null): string => (ratio === null ? T.noRatio : formatRatio(ratio));

export function CalibrationScreen({ tasks, onBack }: CalibrationScreenProps) {
  const { state, retry } = useLoad(() => tasks.calibration());
  return (
    <LoadGate state={state} loadingText={T.loading} onRetry={retry} onBack={onBack}>
      {(model) => <CalibrationBody model={model} onRefresh={retry} onBack={onBack} />}
    </LoadGate>
  );
}

function CalibrationBody({
  model,
  onRefresh,
  onBack,
}: {
  model: CalibrationModel;
  onRefresh: () => void;
  onBack: () => void;
}) {
  useInput((input, key) => {
    if (key.escape) onBack();
    else if (input === KEYS.retry) onRefresh();
  });

  const { total } = model;
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {T.title}
      </Text>
      {total.count === 0 ? (
        <Text>{T.empty}</Text>
      ) : (
        <Box flexDirection="column">
          <Text bold>
            {T.totals(
              total.count,
              formatDuration(total.estimateSeconds),
              formatDuration(total.claudeSeconds),
              formatDuration(total.elapsedSeconds),
            )}
          </Text>
          <Text color={COLORS.brand}>{T.claudeRatio(ratioText(total.claudeRatio))}</Text>
          <Text color={COLORS.brand}>{T.elapsedRatio(ratioText(total.elapsedRatio))}</Text>
          <Text> </Text>
          <Text bold>{T.byRiskTitle}</Text>
          {model.byRisk.map((group) => (
            <Text key={group.risk}>
              {T.riskLine(
                RISK_LABELS[group.risk],
                group.count,
                ratioText(group.claudeRatio),
                ratioText(group.elapsedRatio),
              )}
            </Text>
          ))}
          <Text> </Text>
          <Text bold>{T.outliersTitle}</Text>
          {model.outliers.map((outlier) => (
            <Text key={outlier.key}>
              {T.outlierLine(
                outlier.key,
                truncate(outlier.title, OUTLIER_TITLE_MAX),
                formatDuration(outlier.estimateSeconds),
                formatDuration(outlier.claudeSeconds),
                formatDuration(outlier.elapsedSeconds),
              )}
            </Text>
          ))}
        </Box>
      )}
      {model.planning.count > 0 && (
        <Text>
          {T.planning(
            model.planning.count,
            formatDuration(model.planning.estimateSeconds),
            formatDuration(model.planning.elapsedSeconds),
          )}
        </Text>
      )}
      {model.excludedDirect > 0 && <Text color={COLORS.muted}>{T.excludedDirect(model.excludedDirect)}</Text>}
      {model.unreadable > 0 && <Text color={COLORS.error}>{T.unreadable(model.unreadable)}</Text>}
      {total.count > 0 && <Text color={COLORS.muted}>{T.note}</Text>}
      <Text color={COLORS.muted}>{FOOTER_HINTS.calibration}</Text>
    </Box>
  );
}
