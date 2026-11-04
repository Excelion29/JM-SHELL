import * as fs from 'fs-extra';
import { JiraService } from '../services/jira';
import { ChatBridge, ChatHeader, ChatModel, ChatUiEvent } from '../refinement/chat-types';
import {
  appendTranscript,
  readTranscript,
  recordTurnUsage,
  TRANSCRIPT_HISTORY_LIMIT,
  writeAgentsFile,
  writeSkillCopy,
  writeClaudeSettings,
} from '../refinement/chat-store';
import { ChatEvent, ChatSession, MODELS } from '../refinement/claude-chat';
import { CHAT_FILES, isClaudeAvailable } from '../refinement/claude';
import { bundledSkillPath } from '../refinement/skill';
import {
  assertKey,
  BLOCK_LABELS,
  PHASE_LABELS,
  readState,
  renderDashboard,
  statePath,
  updateState,
} from '../refinement/state';
import {
  ensureNoCodeRoot,
  noCodeRootPath,
  projectKeyOfStory,
  readCwdProject,
  resolveCodeRoot,
  saveRepo,
  suggestCodeRoot,
} from '../refinement/repos';
import { contextTokensOf, exceedsSoftLimit } from '../refinement/usage';
import { ensureSkill, prepareStory } from './refine';

const NO_BLOCK_LABEL = '—';

export interface ChatBridgeHandle extends ChatBridge {
  // Corta el hijo ya (el handoff a Claude completo necesita la sesión libre)
  closeNow: () => void;
}

export function createChatBridge(getJira: () => JiraService): ChatBridgeHandle {
  let root = '';
  let noCode = false;
  // "Refinar sin código" elegido en esta sesión de la app, por proyecto
  const skippedProjects = new Set<string>();
  let session: ChatSession | null = null;
  let listener: ((event: ChatUiEvent) => void) | null = null;
  let key = '';
  let contextTokens = 0;
  // Las escrituras de la copia local se encadenan: cada una relee y reescribe el archivo
  let writes: Promise<void> = Promise.resolve();

  const emit = (event: ChatUiEvent) => listener?.(event);
  const enqueue = (task: () => Promise<void>) => {
    writes = writes
      .then(task)
      .catch((err: unknown) =>
        emit({ type: 'error', message: `No pude guardar la conversación: ${(err as Error).message}` }),
      );
  };

  // null = falta que el dev diga dónde está el código del proyecto
  function resolveRoot(storyKey: string): { root: string; noCode: boolean } | null {
    const projectKey = projectKeyOfStory(storyKey);
    const noCodeRoot = noCodeRootPath(projectKey);
    // Gana la elección explícita de esta sesión y, después, el estado que la historia ya tiene en esa carpeta
    if (skippedProjects.has(projectKey) || fs.pathExistsSync(statePath(noCodeRoot, storyKey))) {
      return { root: ensureNoCodeRoot(projectKey), noCode: true };
    }
    const code = resolveCodeRoot(projectKey);
    return code ? { root: code, noCode: false } : null;
  }

  async function buildHeader(model: ChatModel): Promise<ChatHeader> {
    const state = await readState(root, key);
    if (!state) throw new Error(`La historia ${key} aún no tiene estado.`);
    const { usage } = state;
    return {
      key,
      phase: state.phase,
      phaseLabel: PHASE_LABELS[state.phase],
      blockLabel: state.block ? BLOCK_LABELS[state.block] : NO_BLOCK_LABEL,
      model,
      contextTokens,
      costUsd: usage.costUsd,
      tooLong: exceedsSoftLimit(contextTokens),
    };
  }

  async function onTurnEnd(event: Extract<ChatEvent, { type: 'turnEnd' }>, model: ChatModel): Promise<void> {
    contextTokens = contextTokensOf(event.usage);
    await recordTurnUsage(root, key, event.usage, event.costUsd);
    emit({ type: 'turnEnd', header: await buildHeader(model) });
    if (event.isError) emit({ type: 'error', message: 'Claude no pudo completar esa respuesta. Intenta de nuevo.' });
  }

  function handle(event: ChatEvent, current: ChatSession): void {
    switch (event.type) {
      case 'textDelta':
        emit(event);
        break;
      case 'assistantText':
        emit(event);
        enqueue(() =>
          appendTranscript(root, key, { role: 'assistant', text: event.text, at: new Date().toISOString() }),
        );
        break;
      case 'toolActivity':
        emit({ type: 'activity', tool: event.tool, target: event.target });
        break;
      case 'turnEnd':
        enqueue(() => onTurnEnd(event, current.currentModel));
        break;
      case 'error':
        emit(event);
        break;
      case 'exit':
        emit({ type: 'error', message: 'Claude se cerró. Pulsa Esc y vuelve a entrar para retomar la conversación.' });
        break;
    }
  }

  return {
    async checkCodeFolder(storyKey, force = false) {
      assertKey(storyKey);
      const projectKey = projectKeyOfStory(storyKey);
      const resolved = resolveRoot(storyKey);
      if (resolved && !force) return { status: 'ready', codeFolder: resolved.noCode ? null : resolved.root };
      const current = resolved && !resolved.noCode ? resolved.root : null;
      return {
        status: 'needs-folder',
        projectKey,
        suggestedFolder: current ?? suggestCodeRoot(projectKey, readCwdProject()),
        confirmCwd: current === null,
      };
    },
    async saveCodeFolder(projectKey, folder) {
      try {
        saveRepo(projectKey, folder);
        skippedProjects.delete(projectKey);
        return { ok: true };
      } catch (err: unknown) {
        return { ok: false, message: (err as Error).message };
      }
    },
    skipCodeFolder(projectKey) {
      skippedProjects.add(projectKey);
    },
    async open(storyKey, onEvent) {
      assertKey(storyKey);
      await writes;
      const resolved = resolveRoot(storyKey);
      if (!resolved) throw new Error('Falta indicar dónde está el código del proyecto. Vuelve a abrir la historia.');
      ({ root, noCode } = resolved);
      if (!isClaudeAvailable())
        throw new Error(
          'No encontré `claude` en tu terminal. Instálalo con `npm install -g @anthropic-ai/claude-code`.',
        );
      const skillSource = bundledSkillPath();
      if (!(await fs.pathExists(skillSource)))
        throw new Error('No encontré la skill de refinar dentro del paquete. Reinstala JM-SHELL.');
      key = storyKey;
      listener = onEvent;
      contextTokens = 0;
      await prepareStory(getJira(), root, key);
      await renderDashboard(root);
      await ensureSkill();
      writeAgentsFile(root);
      writeClaudeSettings(root, key);
      writeSkillCopy(root, skillSource);
      const state = await readState(root, key);
      const current = new ChatSession({
        root,
        skillFile: CHAT_FILES.skill,
        agentsFile: CHAT_FILES.agents,
        settingsFile: CHAT_FILES.settings,
        saveSessionId: async (id) => {
          await updateState(root, key, (s) => {
            s.claudeSessionId = id;
          });
        },
      });
      session = current;
      current.onEvent((event) => handle(event, current));
      const history = await readTranscript(root, key, TRANSCRIPT_HISTORY_LIMIT);
      await current.start({ key, sessionId: state?.claudeSessionId ?? null, model: MODELS.conversation, noCode });
      return { header: await buildHeader(current.currentModel), history };
    },
    send(text) {
      if (!session) throw new Error('La conversación no está abierta.');
      session.send(text);
      enqueue(() => appendTranscript(root, key, { role: 'user', text, at: new Date().toISOString() }));
    },
    toggleDeep() {
      if (!session) return;
      const current = session;
      current.switchModel(current.currentModel === MODELS.deep ? MODELS.conversation : MODELS.deep);
      enqueue(async () => emit({ type: 'header', header: await buildHeader(current.currentModel) }));
    },
    newSession() {
      const current = session;
      if (!current) return;
      contextTokens = 0;
      void current
        .startFromLog()
        .then(() => buildHeader(current.currentModel))
        .then((header) => emit({ type: 'header', header }))
        .catch((err: unknown) => emit({ type: 'error', message: (err as Error).message }));
    },
    async close() {
      listener = null;
      session?.close(false);
      await writes;
    },
    closeNow() {
      listener = null;
      session?.close(true);
    },
  };
}
