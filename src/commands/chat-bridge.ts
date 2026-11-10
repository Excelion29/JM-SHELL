import * as fs from 'fs-extra';
import { JiraService } from '../services/jira';
import { formatSeconds } from '../utils/time';
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
import { assertWorkDirUsable, isAnalysisKey, isClaudeAvailable, workFilesOf } from '../refinement/claude';
import {
  advanceAnalysisPhase,
  isValidAnalysisId,
  ANALYSIS_BLOCK_LABELS,
  ANALYSIS_PHASE_LABELS,
  hasAnalysisLogProgress,
  readAnalysis,
  updateAnalysis,
} from '../refinement/analysis';
import { loadPoints, pointsTotals, PointsValidationError } from '../refinement/analysis-points';
import { ensureSourceCopies } from '../refinement/analysis-sources';
import { buildNotesMessage, mergeReferencedNotes } from '../refinement/referenced-notes';
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
import { addTurnUsage, contextTokensOf, exceedsSoftLimit } from '../refinement/usage';
import { CHAT_FILES, workDirFor } from '../refinement/workdir';
import { refreshDashboard } from './dashboard';
import { ensureSkill, prepareStory } from './refine';
import { applyKnowledgeFiles, KnowledgeRuntime, openKnowledge } from './knowledge-runtime';
import { linkedAnalysesOf } from '../refinement/analysis-link';
import { linkedAnalysisLine } from '../refinement/knowledge';
import { invalidateAnalysisListing, listAllAnalyses, openAnalysis, openStory } from './story-resolver';
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
export const INVALID_POINTS_LABEL = 'puntos.json con errores';
const pointsLabel = (count: number, expectedSeconds: number) =>
  `${count} ${count === 1 ? 'punto' : 'puntos'} · ${formatSeconds(expectedSeconds)} esperadas`;

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

  // Un puntos.json a medio escribir no debe tumbar el encabezado
  async function pointsDetail(): Promise<string | undefined> {
    try {
      const points = await loadPoints(activeStore());
      if (points === null) return undefined;
      const totals = pointsTotals(points);
      return pointsLabel(totals.pointCount, totals.expectedSeconds);
    } catch (err: unknown) {
      if (err instanceof PointsValidationError) return INVALID_POINTS_LABEL;
      throw err;
    }
  }

  async function buildHeader(model: ChatModel): Promise<ChatHeader> {
    const common = { key, model, contextTokens, tooLong: exceedsSoftLimit(contextTokens) };
    if (isAnalysisKey(key)) {
      const analysisState = await readAnalysis(activeStore(), key);
      if (!analysisState) throw new Error(`El análisis ${key} aún no tiene estado.`);
      return {
        ...common,
        kind: 'analysis',
        phase: analysisState.phase,
        phaseLabel: ANALYSIS_PHASE_LABELS[analysisState.phase],
        blockLabel: analysisState.block ? ANALYSIS_BLOCK_LABELS[analysisState.block] : NO_BLOCK_LABEL,
        costUsd: analysisState.usage.costUsd,
        detail: await pointsDetail(),
      };
    }
    const state = await readState(activeStore(), key);
    if (!state) throw new Error(`La historia ${key} aún no tiene estado.`);
    return {
      ...common,
      phase: state.phase,
      phaseLabel: PHASE_LABELS[state.phase],
      blockLabel: state.block ? BLOCK_LABELS[state.block] : NO_BLOCK_LABEL,
      costUsd: state.usage.costUsd,
    };
  }

  async function recordUsage(turn: Parameters<typeof recordTurnUsage>[2], costUsd: number): Promise<void> {
    if (!isAnalysisKey(key)) return recordTurnUsage(activeStore(), key, turn, costUsd);
    await updateAnalysis(activeStore(), key, (state) => {
      state.usage = addTurnUsage(state.usage, turn, costUsd);
    });
  }

  async function saveSessionId(id: string): Promise<void> {
    if (!isAnalysisKey(key)) {
      await updateState(activeStore(), key, (s) => {
        s.claudeSessionId = id;
      });
      return;
    }
    await updateAnalysis(activeStore(), key, (s) => {
      s.claudeSessionId = id;
    });
  }

  // Guarda las notas nuevas en el estado y devuelve solo las que no estaban
  async function storeNotes(notes: string[]): Promise<string[]> {
    let fresh: string[] = [];
    const apply = (state: { referencedNotes?: string[] }) => {
      const current = state.referencedNotes ?? [];
      const merged = mergeReferencedNotes(current, notes);
      fresh = merged.filter((note) => !current.includes(note));
      state.referencedNotes = merged;
    };
    if (isAnalysisKey(key)) await updateAnalysis(activeStore(), key, apply);
    else await updateState(activeStore(), key, apply);
    return fresh;
  }

  function sendUserText(text: string): void {
    if (!session) throw new Error('La conversación no está abierta.');
    session.send(text);
    enqueue(() => appendTranscript(activeStore(), { role: 'user', text, at: new Date().toISOString() }));
  }

  async function onTurnEnd(event: Extract<ChatEvent, { type: 'turnEnd' }>, model: ChatModel): Promise<void> {
    contextTokens = contextTokensOf(event.usage);
    await recordUsage(event.usage, event.costUsd);
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

  // Una historia de la épica de un análisis vinculado lo recibe como contexto de solo lectura
  async function linkedAnalysisContext(runtime: KnowledgeRuntime): Promise<string | null> {
    if (isAnalysisKey(key)) return null;
    const epicKey = (await readState(activeStore(), key))?.parentKey ?? null;
    if (!epicKey) return null;
    const linked = linkedAnalysesOf(await listAllAnalyses(root), epicKey);
    return linkedAnalysisLine(linked, runtime.analysisFolderOf) || null;
  }

  async function startChat(
    runtime: KnowledgeRuntime,
    sessionId: string | null,
    skillSource: string,
    subjectName?: string,
  ) {
    const linkedContext = await linkedAnalysisContext(runtime);
    const storyStore = activeStore();
    applyKnowledgeFiles(workDir, runtime, key);
    const files = workFilesOf(workDir, key);
    const skillFileName = isAnalysisKey(key) ? CHAT_FILES.analysisSkill : CHAT_FILES.skill;
    const current = new ChatSession({
      root,
      subjectName,
      skillFile: writeSkillCopy(workDir, skillSource, skillFileName),
      agentsFile: writeAgentsFile(workDir),
      settingsFile: writeClaudeSettings(workDir, key, runtime.kb),
      mcpFile: files.mcp,
      attachmentsDir: files.attachments,
      kb: runtime.kb,
      kbContext: [runtime.context, linkedContext].filter(Boolean).join(' ') || null,
      saveSessionId,
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
    return {
      header: await buildHeader(current.currentModel),
      codeFolder: root,
      history,
      idle: current.isAwaitingFirstMessage,
    };
  }

  return {
    async open(chatKey, onEvent) {
      const analysis = isValidAnalysisId(chatKey);
      if (!analysis) assertKey(chatKey);
      await writes;
      root = projectRoot();
      workDir = workDirFor(root);
      assertWorkDirUsable(workDir);
      if (!isClaudeAvailable())
        throw new Error(
          'No encontré `claude` en tu terminal. Instálalo con `npm install -g @anthropic-ai/claude-code`.',
        );
      const skillSource = bundledSkillPath(analysis ? 'analizar' : 'refinar');
      if (!(await fs.pathExists(skillSource)))
        throw new Error(
          `No encontré la skill de ${analysis ? 'analizar' : 'refinar'} dentro del paquete. Reinstala JM-SHELL.`,
        );
      key = chatKey;
      listener = onEvent;
      contextTokens = 0;
      await closeKnowledge();
      const access = analysis
        ? { store: await openAnalysis(root, key), notice: undefined }
        : await openStory(root, key);
      store = access.store;
      const analysisBefore = analysis ? await readAnalysis(store, key) : null;
      if (analysis && !analysisBefore) throw new Error(`El análisis ${key} no existe.`);
      const before = analysisBefore ?? (await readState(store, key));
      // Antes de escribir nada: si la base no responde, la historia no se toca
      const runtime = await openKnowledge({
        root,
        key,
        hasSession: Boolean(before?.claudeSessionId),
        hasLocalLog: analysisBefore
          ? await hasAnalysisLogProgress(store, analysisBefore.name)
          : await hasLogProgress(store, key),
      });
      knowledge = runtime;
      try {
        if (analysis) {
          await ensureSourceCopies(store, workDir, key);
          await advanceAnalysisPhase(store, key, 'debate');
          invalidateAnalysisListing(root);
        } else {
          await prepareStory(getJira(), store, key, (message) => emit({ type: 'error', message }), workDir);
          await refreshDashboard(root);
        }
        await ensureSkill();
        const analysisNow = analysis ? await readAnalysis(store, key) : null;
        const state = analysisNow ?? (await readState(store, key));
        return {
          ...(await startChat(runtime, state?.claudeSessionId ?? null, skillSource, analysisNow?.name)),
          notice: access.notice,
        };
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
    send: sendUserText,
    async referenceNotes(notes) {
      const fresh = await storeNotes(notes);
      if (fresh.length > 0) sendUserText(buildNotesMessage(fresh, knowledge?.kb ?? null));
      return fresh.length;
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
