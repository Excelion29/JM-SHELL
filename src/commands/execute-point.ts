// Claude Code completo para un punto de análisis: sin Jira, con el tiempo activo sumado en estado.json del análisis
import { info, warn } from '../utils/format';
import { releaseStdin } from '../utils/terminal';
import { formatSeconds } from '../utils/time';
import { assertAnalysisId, readAnalysis, updateAnalysis } from '../refinement/analysis';
import { addPointActiveTime, requireScopedPoint } from '../refinement/analysis-point-runs';
import { renderPointContext } from '../refinement/analysis-point-context';
import { pointExpectedSeconds } from '../refinement/analysis-points';
import {
  analysisDenyRules,
  assertWorkDirUsable,
  isClaudeAvailable,
  launchClaude,
  runClaude,
  taskHandoffArgs,
  workFilesOf,
  writeTaskSettings,
} from '../refinement/claude';
import { projectRoot } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import { workDirFor } from '../refinement/workdir';
import { refreshDashboard } from './dashboard';
import { CLAUDE_INSTALL_HINT } from './execute';
import { applyKnowledgeFiles, type KnowledgeRuntime, openKnowledge } from './knowledge-runtime';
import { ensureSkill } from './refine';
import { openAnalysis } from './story-resolver';

async function launch(
  store: StoryStore,
  id: string,
  pointId: string,
  sessionId: string | null,
  knowledge: KnowledgeRuntime,
): Promise<void> {
  const root = projectRoot();
  const workDir = workDirFor(root);
  const point = await requireScopedPoint(store, pointId);
  const state = await readAnalysis(store, id);
  const expected = pointExpectedSeconds(point);
  const context = renderPointContext({
    analysisId: id,
    analysisName: state?.name ?? id,
    point,
    knowledgeContext: knowledge.context,
    expected: expected === null ? null : formatSeconds(expected),
  });
  applyKnowledgeFiles(workDir, { ...knowledge, context }, id);
  writeTaskSettings(workDir, analysisDenyRules(knowledge.kb, id));
  info('Abriendo Claude Code. Para volver a JM-SHELL escribe /exit o pulsa Ctrl+C dos veces.');
  releaseStdin();
  await launchClaude({
    key: id,
    issueKey: pointId,
    command: 'ejecutar',
    existingSessionId: sessionId,
    cwd: root,
    run: runClaude,
    extraArgs: taskHandoffArgs(knowledge.kb, workFilesOf(workDir, id)),
    saveSessionId: async (newId) => {
      await updateAnalysis(store, id, (analysis) => {
        const run = analysis.pointRuns[pointId];
        if (run) run.claudeSessionId = newId;
      });
    },
  });
}

// Con la app ya desmontada: abre Claude con el contexto del punto y suma el tiempo activo al volver
export async function runPointSession(id: string, pointId: string): Promise<void> {
  assertAnalysisId(id);
  if (!isClaudeAvailable()) throw new Error(`No encontré \`claude\` en tu terminal. ${CLAUDE_INSTALL_HINT}`);
  const root = projectRoot();
  assertWorkDirUsable(workDirFor(root));
  await ensureSkill();

  const store = await openAnalysis(root, id);
  await requireScopedPoint(store, pointId);
  const sessionId = (await readAnalysis(store, id))?.pointRuns[pointId]?.claudeSessionId ?? null;
  const knowledge = await openKnowledge({ root, key: id, hasSession: sessionId !== null, hasLocalLog: false });
  const started = Date.now();
  try {
    await launch(store, id, pointId, sessionId, knowledge);
  } finally {
    await addPointActiveTime(store, id, pointId, Date.now() - started).catch((err: unknown) =>
      warn(`No pude guardar el tiempo de trabajo: ${(err as Error).message}`),
    );
    await knowledge.close();
    await refreshDashboard(root).catch((err: unknown) =>
      warn(`No pude actualizar el inicio: ${(err as Error).message}`),
    );
  }
}
