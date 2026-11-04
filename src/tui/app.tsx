import React, { useState } from 'react';
import { render, useApp } from 'ink';
import { Frame } from './components/frame.js';
import { HomeScreen } from './components/home-screen.js';
// Solo tipos: se borra al compilar
import type { BrowseItem, ProjectItem, StorySummary } from '../refinement/types.js';
import { PinPrompt } from './components/pin-prompt.js';
import { BrowseScreen } from './screens/browse-screen.js';
import { ProjectScreen, SetProjectResult } from './screens/project-screen.js';
import { FOOTER_HINTS, PIN_TEXTS } from './texts.js';

export type { StorySummary, BrowseItem, ProjectItem, SetProjectResult };

export interface UnlockResult {
  ok: boolean;
  message?: string;
}

export interface AppAction {
  type: 'refine';
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
  onAction?: (action: AppAction) => void;
}

type Stage = 'pin' | 'home' | 'browse' | 'projects';

const STAGE_HINTS: Record<Stage, string> = {
  pin: FOOTER_HINTS.pin,
  home: FOOTER_HINTS.home,
  browse: '',
  projects: '',
};

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
  onAction,
}: AppProps) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>(unlocked ? 'home' : 'pin');
  const [projectsReturnTo, setProjectsReturnTo] = useState<Stage>('home');
  const [projectKey, setProjectKey] = useState(initialProjectKey);
  const [stories, setStories] = useState(initialStories);
  const [checking, setChecking] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const handlePin = async (pin: string) => {
    setChecking(true);
    setPinError(null);
    try {
      const result = await unlock(pin);
      if (result.ok) setStage('home');
      else setPinError(result.message ?? PIN_TEXTS.wrongPinFallback);
    } catch {
      setPinError(PIN_TEXTS.wrongPinFallback);
    } finally {
      setChecking(false);
    }
  };

  const handleRefine = (key: string) => {
    onAction?.({ type: 'refine', key });
    exit();
  };

  const openProjects = (from: Stage) => {
    setProjectsReturnTo(from);
    setStage('projects');
  };

  return (
    <Frame projectKey={projectKey} hint={STAGE_HINTS[stage]}>
      {stage === 'pin' && <PinPrompt onSubmit={handlePin} error={pinError} checking={checking} />}
      {stage === 'home' && (
        <HomeScreen
          stories={stories}
          onRefine={handleRefine}
          onBrowse={() => setStage('browse')}
          onChangeProject={() => openProjects('home')}
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
