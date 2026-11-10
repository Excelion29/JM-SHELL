import type { JiraService } from '../services/jira';
import { releaseStdin } from '../utils/terminal';
import { info, warn } from '../utils/format';
import { writeKnowledgeContext } from '../refinement/chat-store';
import {
  assertWorkDirUsable,
  isClaudeAvailable,
  launchClaude,
  runClaude,
  taskHandoffArgs,
  workFilesOf,
  writeTaskSettings,
} from '../refinement/claude';
import { prepareTaskContext } from '../refinement/execution';
import { hasLogProgress, assertKey, projectRoot, readState, updateState } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import { workDirFor } from '../refinement/workdir';
import { refreshDashboard } from './dashboard';
import { ensureSkill } from './refine';
import { applyKnowledgeFiles, KnowledgeRuntime, openKnowledge } from './knowledge-runtime';
import { openStory } from './story-resolver';

export const CLAUDE_INSTALL_HINT = 'Instálalo con `npm install -g @anthropic-ai/claude-code` y vuelve a intentar.';

interface TaskSession {
  jira: JiraService;
  root: string;
  workDir: string;
  storyKey: string | null;
  issueKey: string;
  store: StoryStore | null;
  knowledge: KnowledgeRuntime | null;
}

async function sessionIdOf(
  store: StoryStore | null,
  storyKey: string | null,
  issueKey: string,
): Promise<string | null> {
  if (!store || !storyKey) return null;
  return (await readState(store, storyKey))?.taskRuns[issueKey]?.claudeSessionId ?? null;
}

async function addActiveTime(session: TaskSession, elapsedMs: number): Promise<void> {
  const { store, storyKey, issueKey } = session;
  if (!store || !storyKey) return;
  await updateState(store, storyKey, (state) => {
    const run = state.taskRuns[issueKey];
    if (run) run.activeMs += elapsedMs;
  });
}

async function launch(session: TaskSession): Promise<void> {
  const { jira, root, workDir, storyKey, issueKey, store, knowledge } = session;
  const context = await prepareTaskContext({ jira, store }, storyKey, issueKey, knowledge?.context ?? null);
  const folderKey = storyKey ?? issueKey;
  if (knowledge) applyKnowledgeFiles(workDir, { ...knowledge, context }, folderKey);
  else writeKnowledgeContext(workDir, context);
  writeTaskSettings(workDir);
  info('Abriendo Claude Code. Para volver a JM-SHELL escribe /exit o pulsa Ctrl+C dos veces.');
  releaseStdin();
  await launchClaude({
    key: folderKey,
    issueKey,
    command: 'ejecutar',
    existingSessionId: await sessionIdOf(store, storyKey, issueKey),
    cwd: root,
    run: runClaude,
    extraArgs: taskHandoffArgs(knowledge?.kb ?? null, workFilesOf(workDir, folderKey)),
    saveSessionId: async (id) => {
      if (!store || !storyKey) return;
      await updateState(store, storyKey, (state) => {
        const run = state.taskRuns[issueKey];
        if (run) run.claudeSessionId = id;
      });
    },
  });
}

// Con la app ya desmontada: abre Claude completo con el contexto de la tarea y suma el tiempo activo al volver
export async function runTaskSession(jira: JiraService, storyKey: string | null, issueKey: string): Promise<void> {
  assertKey(issueKey);
  if (storyKey) assertKey(storyKey);
  if (!isClaudeAvailable()) throw new Error(`No encontré \`claude\` en tu terminal. ${CLAUDE_INSTALL_HINT}`);
  const root = projectRoot();
  const workDir = workDirFor(root);
  assertWorkDirUsable(workDir);
  await ensureSkill();

  const store = storyKey ? (await openStory(root, storyKey)).store : null;
  const knowledge =
    store && storyKey
      ? await openKnowledge({
          root,
          key: storyKey,
          hasSession: Boolean(await sessionIdOf(store, storyKey, issueKey)),
          hasLocalLog: await hasLogProgress(store, storyKey),
        })
      : null;
  const session: TaskSession = { jira, root, workDir, storyKey, issueKey, store, knowledge };
  const started = Date.now();
  try {
    await launch(session);
  } finally {
    await addActiveTime(session, Date.now() - started).catch((err: unknown) =>
      warn(`No pude guardar el tiempo de trabajo: ${(err as Error).message}`),
    );
    await knowledge?.close();
    await refreshDashboard(root).catch((err: unknown) =>
      warn(`No pude actualizar el inicio: ${(err as Error).message}`),
    );
  }
}
