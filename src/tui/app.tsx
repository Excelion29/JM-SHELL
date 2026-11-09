import React, { useEffect, useState } from 'react';
import { render, Text, useApp, useInput } from 'ink';
import { Frame } from './components/frame.js';
import { HomeScreen } from './components/home-screen.js';
// Solo tipos: se borra al compilar
import type { ChatBridge, KnowledgeStatus } from '../refinement/chat-types.js';
import type { ManagementBridge, ManagementStatus } from '../refinement/management-types.js';
import type { PlanBridge } from '../refinement/review-types.js';
import type { TaskFinishTarget, TasksBridge } from '../refinement/tasks-types.js';
import type { BrowseItem, ProjectItem, StorySummary } from '../refinement/types.js';
import { KnowledgeConfirm, KnowledgePrompt } from './components/knowledge-prompt.js';
import { createAltScreen } from './terminal.js';
import { PinPrompt } from './components/pin-prompt.js';
import { BrowseScreen } from './screens/browse-screen.js';
import { ChatScreen } from './screens/chat-screen.js';
import { CloseScreen } from './screens/close-screen.js';
import { KnowledgeScreen } from './screens/knowledge-screen.js';
import { CalibrationScreen } from './screens/calibration-screen.js';
import { ManagementScreen } from './screens/management-screen.js';
import { MyDayScreen } from './screens/my-day-screen.js';
import { PlanScreen } from './screens/plan-screen.js';
import { PlanningScreen } from './screens/planning-screen.js';
import { TaskFinishScreen } from './screens/task-finish-screen.js';
import { TasksScreen } from './screens/tasks-screen.js';
import { ProjectScreen, SetProjectResult } from './screens/project-screen.js';
import {
  COLORS,
  FOOTER_HINTS,
  KNOWLEDGE_SETTINGS_TEXTS,
  KNOWLEDGE_TEXTS,
  MANAGEMENT_TEXTS,
  PIN_TEXTS,
} from './texts.js';

export type { StorySummary, BrowseItem, ProjectItem, SetProjectResult };

export interface UnlockResult {
  ok: boolean;
  message?: string;
}

// Pedido de abrir Claude Code completo: se atiende con la app ya desmontada
export type AppAction =
  | { type: 'handoff'; key: string }
  // Claude completo con el contexto de una subtarea; storyKey es null si no es de una historia de jm
  | { type: 'runTask'; storyKey: string | null; issueKey: string };

export interface AppProps {
  projectKey: string | null;
  stories: StorySummary[];
  unlocked?: boolean;
  unlock: (pin: string) => Promise<UnlockResult>;
  fetchEpics: () => Promise<BrowseItem[]>;
  fetchStories: (epicKey: string | null) => Promise<BrowseItem[]>;
  fetchProjects: () => Promise<ProjectItem[]>;
  setProject: (key: string) => Promise<SetProjectResult>;
  loadStories: (projectKey: string | null) => Promise<StorySummary[]>;
  chat: ChatBridge;
  plan: PlanBridge;
  tasks?: TasksBridge;
  management?: ManagementBridge;
  initialTaskFinish?: TaskFinishTarget | null;
  initialChatKey?: string | null;
  notice?: string | null;
  onAction?: (action: AppAction) => void;
}

// 'routing': decide entre pedir la base de conocimiento o abrir el chat
const ROUTE_BY_STATUS = { unset: 'knowledge', untrusted: 'knowledgeConfirm', set: 'chat' } as const;
// Si no se puede leer la gestión no se pregunta: la Planificación cae en la historia como sin gestión
const MANAGEMENT_UNREADABLE: ManagementStatus = 'none';

type Stage =
  | 'pin'
  | 'home'
  | 'browse'
  | 'projects'
  | 'routing'
  | 'knowledge'
  | 'knowledgeConfirm'
  | 'knowledgeSettings'
  | 'managementCheck'
  | 'management'
  | 'planning'
  | 'chat'
  | 'review'
  | 'close'
  | 'tasks'
  | 'taskFinish'
  | 'myDay'
  | 'calibration';

const NOTICE_STAGES: readonly Stage[] = ['home', 'chat', 'tasks', 'myDay'];

// La clave de la historia es PROYECTO-NÚMERO
const projectOfKey = (key: string): string => key.slice(0, key.lastIndexOf('-'));

function hintFor(stage: Stage, choiceCount: number): string {
  if (stage === 'pin') return FOOTER_HINTS.pin;
  if (stage === 'home') return FOOTER_HINTS.home;
  if (stage === 'knowledge' || stage === 'knowledgeConfirm') return FOOTER_HINTS.knowledge;
  if (stage === 'knowledgeSettings') return FOOTER_HINTS.knowledgeSettings;
  if (stage === 'management') return FOOTER_HINTS.management;
  if (stage === 'managementCheck') return FOOTER_HINTS.managementCheck;
  if (stage !== 'chat') return '';
  return choiceCount > 0 ? `${FOOTER_HINTS.choose(choiceCount)} · ${FOOTER_HINTS.chat}` : FOOTER_HINTS.chat;
}

export function App({
  projectKey: initialProjectKey,
  stories: initialStories,
  unlocked = false,
  unlock,
  fetchEpics,
  fetchStories,
  fetchProjects,
  setProject,
  loadStories,
  chat,
  plan,
  tasks,
  management,
  initialTaskFinish = null,
  initialChatKey = null,
  notice: initialNotice = null,
  onAction,
}: AppProps) {
  const { exit } = useApp();
  const [notice, setNotice] = useState(initialNotice);
  // Ink apaga el modo raw al quedar sin ningún useInput montado, y en consolas Windows reactivarlo tras una pausa falla
  useInput(() => setNotice(null));
  const [chatKey, setChatKey] = useState<string | null>(initialChatKey);
  const [storyKey, setStoryKey] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(
    unlocked ? (initialTaskFinish && tasks ? 'taskFinish' : initialChatKey ? 'routing' : 'home') : 'pin',
  );
  const [finishTarget, setFinishTarget] = useState(initialTaskFinish);
  // Planificación abierta de la historia del chat: al salir se pregunta si terminó y se vuelve al inicio
  const [planningKey, setPlanningKey] = useState<string | null>(null);
  const [finishToHome, setFinishToHome] = useState(false);
  const [projectsReturnTo, setProjectsReturnTo] = useState<Stage>('home');
  const [managementNext, setManagementNext] = useState<Stage>('home');
  // Proyecto por el que se pregunta: el de la historia al entrar, el de la app al cambiar de proyecto o con g
  const [managementProject, setManagementProject] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState(initialProjectKey);
  const [stories, setStories] = useState(initialStories);
  const [checking, setChecking] = useState(false);
  const [choiceCount, setChoiceCount] = useState(0);
  const [pinError, setPinError] = useState<string | null>(null);

  const handlePin = async (pin: string) => {
    setChecking(true);
    setPinError(null);
    try {
      const result = await unlock(pin);
      if (result.ok) {
        // Con el PIN ya se puede leer la base de conocimiento: el listado previo solo traía lo local
        setStories(await loadStories(projectKey));
        setStage(chatKey ? 'routing' : 'home');
      } else setPinError(result.message ?? PIN_TEXTS.wrongPinFallback);
    } catch {
      setPinError(PIN_TEXTS.wrongPinFallback);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (stage !== 'routing') return;
    // Si no se puede leer el estado de la base, el chat lo reporta con un mensaje claro al abrir
    chat
      .knowledgeStatus()
      .catch((): KnowledgeStatus => 'set')
      .then((status) => setStage(ROUTE_BY_STATUS[status] === 'chat' ? entryRoute : ROUTE_BY_STATUS[status]));
  }, [stage, chat]);

  // La gestión del proyecto se pregunta una sola vez: solo si nunca respondió, y luego sigue a `next`
  const askManagementThen = async (key: string | null, next: Stage) => {
    const status =
      key && management ? await management.status(key).catch(() => MANAGEMENT_UNREADABLE) : MANAGEMENT_UNREADABLE;
    if (status === 'unset') {
      setManagementProject(key);
      setManagementNext(next);
      setStage('management');
    } else setStage(next);
  };

  useEffect(() => {
    if (stage === 'managementCheck') void askManagementThen(chatKey ? projectOfKey(chatKey) : null, chatEntry);
  }, [stage]);

  // Sin puente de tareas (p. ej. pruebas del chat) no hay Planificación que registrar
  const chatEntry: Stage = tasks ? 'planning' : 'chat';
  // Antes de la Planificación: la gestión del proyecto, si aún no se respondió
  const entryRoute: Stage = tasks && management && chatKey ? 'managementCheck' : chatEntry;

  const handleRefine = (key: string) => {
    setChatKey(key);
    setStage('routing');
  };

  const leaveChat = async () => {
    if (planningKey && chatKey && tasks) {
      setFinishTarget({ storyKey: chatKey, issueKey: planningKey });
      setFinishToHome(true);
      setPlanningKey(null);
      setChatKey(null);
      setStage('taskFinish');
      return;
    }
    setChatKey(null);
    setStories(await loadStories(projectKey));
    setStage('home');
  };

  const leaveStoryScreen = async () => {
    setStoryKey(null);
    setStories(await loadStories(projectKey));
    setStage('home');
  };

  const openStoryScreen = (key: string, next: 'review' | 'close' | 'tasks') => {
    setStoryKey(key);
    setStage(next);
  };

  const handleHandoff = (key: string) => {
    onAction?.({ type: 'handoff', key });
    exit();
  };

  const handleRunTask = (taskStoryKey: string | null, issueKey: string) => {
    onAction?.({ type: 'runTask', storyKey: taskStoryKey, issueKey });
    exit();
  };

  const finishTask = (message: string) => {
    // Después de la tecla que respondió: el useInput global de arriba borra el aviso con cada pulsación
    queueMicrotask(() => setNotice(message));
    const target = finishTarget;
    setFinishTarget(null);
    if (finishToHome) {
      setFinishToHome(false);
      void leaveStoryScreen();
    } else if (target?.storyKey) openStoryScreen(target.storyKey, 'tasks');
    else void leaveStoryScreen();
  };

  const openKnowledgeSettings = () => {
    if (projectKey) setStage('knowledgeSettings');
    // Después de la tecla que respondió: el useInput global borra el aviso con cada pulsación
    else queueMicrotask(() => setNotice(KNOWLEDGE_SETTINGS_TEXTS.needsProject));
  };

  const openManagement = () => {
    if (!management) return;
    if (projectKey) {
      setManagementProject(projectKey);
      setManagementNext('home');
      setStage('management');
    } else queueMicrotask(() => setNotice(MANAGEMENT_TEXTS.needsProject));
  };

  const openProjects = (from: Stage) => {
    setProjectsReturnTo(from);
    setStage('projects');
  };

  return (
    <Frame projectKey={projectKey} hint={hintFor(stage, choiceCount)}>
      {notice && NOTICE_STAGES.includes(stage) && <Text color={COLORS.brand}>{notice}</Text>}
      {(stage === 'routing' || stage === 'managementCheck') && <Text>{KNOWLEDGE_TEXTS.routing}</Text>}
      {stage === 'pin' && <PinPrompt onSubmit={handlePin} error={pinError} checking={checking} />}
      {stage === 'home' && (
        <HomeScreen
          stories={stories}
          onRefine={handleRefine}
          onBrowse={() => setStage('browse')}
          onChangeProject={() => openProjects('home')}
          onReview={(key) => openStoryScreen(key, 'review')}
          onCloseStory={(key) => openStoryScreen(key, 'close')}
          onTasks={(key) => tasks && openStoryScreen(key, 'tasks')}
          onMyDay={() => tasks && setStage('myDay')}
          onKnowledge={openKnowledgeSettings}
          onCalibration={() => tasks && setStage('calibration')}
          onManagement={openManagement}
          onQuit={exit}
        />
      )}
      {stage === 'browse' && (
        <BrowseScreen
          localStories={stories}
          fetchEpics={fetchEpics}
          fetchStories={fetchStories}
          onRefine={handleRefine}
          onChangeProject={() => openProjects('browse')}
          onBack={() => setStage('home')}
        />
      )}
      {stage === 'knowledge' && (
        <KnowledgePrompt chat={chat} onDone={() => setStage(entryRoute)} onCancel={() => void leaveChat()} />
      )}
      {stage === 'knowledgeConfirm' && (
        <KnowledgeConfirm chat={chat} onDone={() => setStage(entryRoute)} onCancel={() => void leaveChat()} />
      )}
      {stage === 'knowledgeSettings' && (
        <KnowledgeScreen
          chat={chat}
          onChanged={() => void loadStories(projectKey).then(setStories)}
          onBack={() => setStage('home')}
        />
      )}
      {stage === 'management' && managementProject && management && (
        <ManagementScreen
          projectKey={managementProject}
          management={management}
          fetchEpics={fetchEpics}
          onDone={() => setStage(managementNext)}
        />
      )}
      {stage === 'planning' && chatKey && tasks && (
        <PlanningScreen
          storyKey={chatKey}
          tasks={tasks}
          onDone={(message, key) => {
            setPlanningKey(key);
            // Después de la tecla que respondió: el useInput global borra el aviso con cada pulsación
            if (message) queueMicrotask(() => setNotice(message));
            setStage('chat');
          }}
        />
      )}
      {stage === 'chat' && chatKey && (
        <ChatScreen
          chatKey={chatKey}
          chat={chat}
          onBack={() => void leaveChat()}
          onHandoff={() => handleHandoff(chatKey)}
          onChoicesChange={setChoiceCount}
        />
      )}
      {stage === 'review' && storyKey && (
        <PlanScreen
          storyKey={storyKey}
          plan={plan}
          onBack={() => void leaveStoryScreen()}
          onFinished={() => void leaveStoryScreen()}
        />
      )}
      {stage === 'close' && storyKey && (
        <CloseScreen storyKey={storyKey} plan={plan} onBack={() => void leaveStoryScreen()} />
      )}
      {stage === 'tasks' && storyKey && tasks && (
        <TasksScreen
          storyKey={storyKey}
          tasks={tasks}
          plan={plan}
          onBack={() => void leaveStoryScreen()}
          onRunTask={handleRunTask}
        />
      )}
      {stage === 'myDay' && tasks && (
        <MyDayScreen tasks={tasks} onBack={() => void leaveStoryScreen()} onRunTask={handleRunTask} />
      )}
      {stage === 'calibration' && tasks && <CalibrationScreen tasks={tasks} onBack={() => setStage('home')} />}
      {stage === 'taskFinish' && finishTarget && tasks && (
        <TaskFinishScreen target={finishTarget} tasks={tasks} onDone={finishTask} />
      )}
      {stage === 'projects' && (
        <ProjectScreen
          currentKey={projectKey}
          fetchProjects={fetchProjects}
          setProject={setProject}
          onChanged={async (key) => {
            setProjectKey(key);
            setStories(await loadStories(key));
            await askManagementThen(key, projectsReturnTo);
          }}
          onBack={() => setStage(projectsReturnTo)}
        />
      )}
    </Frame>
  );
}

export async function runApp(props: Omit<AppProps, 'onAction'>): Promise<AppAction | null> {
  let action: AppAction | null = null;
  const altScreen = createAltScreen(process.stdout);
  altScreen.enter();
  try {
    const instance = render(<App {...props} onAction={(a) => (action = a)} />);
    await instance.waitUntilExit();
  } finally {
    // Antes del traspaso a claude o de volver a la terminal, esta debe quedar como estaba
    altScreen.leave();
  }
  return action;
}
