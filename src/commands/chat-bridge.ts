import * as fs from 'fs-extra';
import { JiraService } from '../services/jira';
import { ChatBridge, ChatHeader, ChatModel, ChatUiEvent } from '../refinement/chat-types';
import {
  appendTranscript,
  openTranscript,
  recordTurnUsage,
  TRANSCRIPT_MAX_ENTRIES,
  writeAgentsFile,
  writeSkillCopy,
  writeClaudeSettings,
} from '../refinement/chat-store';
import { ChatEvent, ChatSession, MODELS } from '../refinement/claude-chat';
import { assertWorkDirUsable, isClaudeAvailable, workFilesOf } from '../refinement/claude';
import { bundledSkillPath } from '../refinement/skill';
import {
  assertKey,
  BLOCK_LABELS,
  hasLogProgress,
  PHASE_LABELS,
  projectRoot,
  readState,
  updateState,
} from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import { contextTokensOf, exceedsSoftLimit } from '../refinement/usage';
import { workDirFor } from '../refinement/workdir';
import { refreshDashboard } from './dashboard';
import { ensureSkill, prepareStory } from './refine';
import { applyKnowledgeFiles, KnowledgeRuntime, openKnowledge } from './knowledge-runtime';
import { openStory } from './story-resolver';
import {
  changeKnowledge,
  confirmKnowledge,
  describeKnowledge,
  inspectServer,
  knowledgeSettings,
  knowledgeStatus,
  listKnowledge,
  previewKnowledge,
  renewKnowledgeKey,
  resolveTarget,
  saveKnowledge,
} from './knowledge-setup';

const NO_BLOCK_LABEL = '—';

export interface ChatBridgeHandle extends ChatBridge {
  // Corta el hijo ya (el handoff a Claude completo necesita la sesión libre)
  closeNow: () => void;
}

export function createChatBridge(getJira: () => JiraService): ChatBridgeHandle {
  let root = '';
  let workDir = '';
  let store: StoryStore | null = null;
  let session: ChatSession | null = null;
  let listener: ((event: ChatUiEvent) => void) | null = null;
  let key = '';
  let contextTokens = 0;
  let knowledge: KnowledgeRuntime | null = null;
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

  // El intermediario MCP vive mientras dure la conversación
  async function closeKnowledge(): Promise<void> {
    const current = knowledge;
    knowledge = null;
    await current?.close();
  }

  const activeStore = (): StoryStore => {
    if (!store) throw new Error('La conversación no está abierta.');
    return store;
  };

  async function buildHeader(model: ChatModel): Promise<ChatHeader> {
    const state = await readState(activeStore(), key);
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
    await recordTurnUsage(activeStore(), key, event.usage, event.costUsd);
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
          appendTranscript(activeStore(), { role: 'assistant', text: event.text, at: new Date().toISOString() }),
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

  async function startChat(runtime: KnowledgeRuntime, sessionId: string | null, skillSource: string) {
    const storyStore = activeStore();
    applyKnowledgeFiles(workDir, runtime, key);
    const files = workFilesOf(workDir, key);
    const current = new ChatSession({
      root,
      skillFile: writeSkillCopy(workDir, skillSource),
      agentsFile: writeAgentsFile(workDir),
      settingsFile: writeClaudeSettings(workDir, key, runtime.kb),
      mcpFile: files.mcp,
      attachmentsDir: files.attachments,
      kb: runtime.kb,
      kbContext: runtime.context,
      saveSessionId: async (id) => {
        await updateState(storyStore, key, (s) => {
          s.claudeSessionId = id;
        });
      },
    });
    session = current;
    current.onEvent((event) => handle(event, current));
    const history = await openTranscript(storyStore, TRANSCRIPT_MAX_ENTRIES);
    const startMessage = runtime.startMessage === 'resume' ? undefined : runtime.startMessage;
    await current.start({
      key,
      sessionId,
      model: MODELS.conversation,
      startMessage,
      hasHistory: history.length > 0,
    });
    return { header: await buildHeader(current.currentModel), codeFolder: root, history, idle: current.isAwaitingFirstMessage };
  }

  return {
    async open(storyKey, onEvent) {
      assertKey(storyKey);
      await writes;
      root = projectRoot();
      workDir = workDirFor(root);
      assertWorkDirUsable(workDir);
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
      await closeKnowledge();
      const access = await openStory(root, key);
      store = access.store;
      const before = await readState(store, key);
      // Antes de escribir nada: si la base no responde, la historia no se toca
      const runtime = await openKnowledge({
        root,
        key,
        hasSession: Boolean(before?.claudeSessionId),
        hasLocalLog: await hasLogProgress(store, key),
      });
      knowledge = runtime;
      try {
        await prepareStory(getJira(), store, key, (message) => emit({ type: 'error', message }), workDir);
        await refreshDashboard(root);
        await ensureSkill();
        const state = await readState(store, key);
        return { ...(await startChat(runtime, state?.claudeSessionId ?? null, skillSource)), notice: access.notice };
      } catch (err: unknown) {
        await closeKnowledge();
        throw err;
      }
    },
    async knowledgeStatus() {
      return knowledgeStatus(projectRoot());
    },
    inspectServer,
    listKnowledge: async (target, dir) => listKnowledge(await resolveTarget(projectRoot(), target), dir),
    previewKnowledge: async (target, file) => previewKnowledge(await resolveTarget(projectRoot(), target), file),
    saveKnowledge: (choice) => saveKnowledge(projectRoot(), choice),
    knowledgeSettings: () => knowledgeSettings(projectRoot()),
    changeKnowledge: (choice) => changeKnowledge(projectRoot(), choice),
    renewKnowledgeKey: (apiKey) => renewKnowledgeKey(projectRoot(), apiKey),
    describeKnowledge: () => describeKnowledge(projectRoot()),
    trustKnowledge: () => confirmKnowledge(projectRoot()),
    send(text) {
      if (!session) throw new Error('La conversación no está abierta.');
      session.send(text);
      enqueue(() => appendTranscript(activeStore(), { role: 'user', text, at: new Date().toISOString() }));
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
      await closeKnowledge();
      await writes;
    },
    closeNow() {
      listener = null;
      session?.close(true);
      void closeKnowledge();
    },
  };
}
