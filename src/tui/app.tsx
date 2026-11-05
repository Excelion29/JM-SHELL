import React, { useEffect, useState } from 'react';
import { render, Text, useApp, useInput } from 'ink';
import { Frame } from './components/frame.js';
import { HomeScreen } from './components/home-screen.js';
// Solo tipos: se borra al compilar
import type { ChatBridge, KnowledgeStatus } from '../refinement/chat-types.js';
import type { PlanBridge } from '../refinement/review-types.js';
import type { BrowseItem, ProjectItem, StorySummary } from '../refinement/types.js';
import { KnowledgeConfirm, KnowledgePrompt } from './components/knowledge-prompt.js';
import { PinPrompt } from './components/pin-prompt.js';
import { BrowseScreen } from './screens/browse-screen.js';
import { ChatScreen } from './screens/chat-screen.js';
import { CloseScreen } from './screens/close-screen.js';
import { PlanScreen } from './screens/plan-screen.js';
import { ProjectScreen, SetProjectResult } from './screens/project-screen.js';
import { FOOTER_HINTS, KNOWLEDGE_TEXTS, PIN_TEXTS } from './texts.js';

export type { StorySummary, BrowseItem, ProjectItem, SetProjectResult };

export interface UnlockResult {
  ok: boolean;
  message?: string;
}

// Pedido de abrir Claude Code completo: se atiende con la app ya desmontada
export interface AppAction {
  type: 'handoff';
  key: string;
}

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
  initialChatKey?: string | null;
  onAction?: (action: AppAction) => void;
}

// 'routing': decide entre pedir la base de conocimiento o abrir el chat
const ROUTE_BY_STATUS = { unset: 'knowledge', untrusted: 'knowledgeConfirm', set: 'chat' } as const;

type Stage = 'pin' | 'home' | 'browse' | 'projects' | 'routing' | 'knowledge' | 'knowledgeConfirm' | 'chat' | 'review' | 'close';

function hintFor(stage: Stage, choiceCount: number): string {
  if (stage === 'pin') return FOOTER_HINTS.pin;
  if (stage === 'home') return FOOTER_HINTS.home;
  if (stage === 'knowledge' || stage === 'knowledgeConfirm') return FOOTER_HINTS.knowledge;
  if (stage !== 'chat') return '';
  return choiceCount > 0 ? `${FOOTER_HINTS.choose(choiceCount)} · ${FOOTER_HINTS.chat}` : FOOTER_HINTS.chat;
}

// Ink apaga el modo raw al quedar sin ningún useInput montado, y en consolas Windows reactivarlo tras una pausa falla
const keepRawModeAlive = () => undefined;

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
  initialChatKey = null,
  onAction,
}: AppProps) {
  const { exit } = useApp();
  useInput(keepRawModeAlive);
  const [chatKey, setChatKey] = useState<string | null>(initialChatKey);
  const [storyKey, setStoryKey] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(unlocked ? (initialChatKey ? 'routing' : 'home') : 'pin');
  const [projectsReturnTo, setProjectsReturnTo] = useState<Stage>('home');
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
      if (result.ok) setStage(chatKey ? 'routing' : 'home');
      else setPinError(result.message ?? PIN_TEXTS.wrongPinFallback);
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
      .then((status) => setStage(ROUTE_BY_STATUS[status]));
  }, [stage, chat]);

  const handleRefine = (key: string) => {
    setChatKey(key);
    setStage('routing');
  };

  const leaveChat = async () => {
    setChatKey(null);
    setStories(await loadStories(projectKey));
    setStage('home');
  };

  const leaveStoryScreen = async () => {
    setStoryKey(null);
    setStories(await loadStories(projectKey));
    setStage('home');
  };

  const openStoryScreen = (key: string, next: 'review' | 'close') => {
    setStoryKey(key);
    setStage(next);
  };

  const handleHandoff = (key: string) => {
    onAction?.({ type: 'handoff', key });
    exit();
  };

  const openProjects = (from: Stage) => {
    setProjectsReturnTo(from);
    setStage('projects');
  };

  return (
    <Frame projectKey={projectKey} hint={hintFor(stage, choiceCount)}>
      {stage === 'routing' && <Text>{KNOWLEDGE_TEXTS.routing}</Text>}
      {stage === 'pin' && <PinPrompt onSubmit={handlePin} error={pinError} checking={checking} />}
      {stage === 'home' && (
        <HomeScreen
          stories={stories}
          onRefine={handleRefine}
          onBrowse={() => setStage('browse')}
          onChangeProject={() => openProjects('home')}
          onReview={(key) => openStoryScreen(key, 'review')}
          onCloseStory={(key) => openStoryScreen(key, 'close')}
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
        <KnowledgePrompt chat={chat} onDone={() => setStage('chat')} onCancel={() => void leaveChat()} />
      )}
      {stage === 'knowledgeConfirm' && (
        <KnowledgeConfirm chat={chat} onDone={() => setStage('chat')} onCancel={() => void leaveChat()} />
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
      {stage === 'projects' && (
        <ProjectScreen
          currentKey={projectKey}
          fetchProjects={fetchProjects}
          setProject={setProject}
          onChanged={async (key) => {
            setProjectKey(key);
            setStories(await loadStories(key));
            setStage(projectsReturnTo);
          }}
          onBack={() => setStage(projectsReturnTo)}
        />
      )}
    </Frame>
  );
}

export async function runApp(props: Omit<AppProps, 'onAction'>): Promise<AppAction | null> {
  let action: AppAction | null = null;
  const instance = render(<App {...props} onAction={(a) => (action = a)} />);
  await instance.waitUntilExit();
  return action;
}
