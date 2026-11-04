import * as fs from 'fs-extra';
import { JiraService } from '../services/jira';
import { ChatBridge, ChatHeader, ChatModel, ChatUiEvent } from '../refinement/chat-types';
import {
  appendTranscript,
  readTranscript,
  recordTurnUsage,
  TRANSCRIPT_HISTORY_LIMIT,
  writeAgentsFile,
  writeClaudeSettings,
} from '../refinement/chat-store';
import { ChatEvent, ChatSession, MODELS } from '../refinement/claude-chat';
import { isClaudeAvailable } from '../refinement/claude';
import { bundledSkillPath } from '../refinement/skill';
import { assertKey, BLOCK_LABELS, PHASE_LABELS, readState, renderDashboard, updateState } from '../refinement/state';
import { contextTokensOf, exceedsSoftLimit } from '../refinement/usage';
import { ensureSkill, prepareStory } from './refine';

const NO_BLOCK_LABEL = '—';

export interface ChatBridgeHandle extends ChatBridge {
  // Corta el hijo ya (el handoff a Claude completo necesita la sesión libre)
  closeNow: () => void;
}

export function createChatBridge(root: string, getJira: () => JiraService): ChatBridgeHandle {
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
      totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens,
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
    async open(storyKey, onEvent) {
      assertKey(storyKey);
      if (!isClaudeAvailable())
        throw new Error(
          'No encontré `claude` en tu terminal. Instálalo con `npm install -g @anthropic-ai/claude-code`.',
        );
      const skillFile = bundledSkillPath();
      if (!(await fs.pathExists(skillFile)))
        throw new Error('No encontré la skill de refinar dentro del paquete. Reinstala JM-SHELL.');
      key = storyKey;
      listener = onEvent;
      contextTokens = 0;
      await prepareStory(getJira(), root, key);
      await renderDashboard(root);
      await ensureSkill();
      const state = await readState(root, key);
      const current = new ChatSession({
        root,
        skillFile,
        agentsFile: writeAgentsFile(root),
        settingsFile: writeClaudeSettings(root, key),
        saveSessionId: async (id) => {
          await updateState(root, key, (s) => {
            s.claudeSessionId = id;
          });
        },
      });
      session = current;
      current.onEvent((event) => handle(event, current));
      const history = await readTranscript(root, key, TRANSCRIPT_HISTORY_LIMIT);
      await current.start({ key, sessionId: state?.claudeSessionId ?? null, model: MODELS.conversation });
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
