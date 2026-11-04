import React, { useState } from 'react';
import { render, useApp } from 'ink';
import { Frame } from './components/frame.js';
import { HomeScreen } from './components/home-screen.js';
// Solo tipos: se borra al compilar
import type { StorySummary } from '../refinement/types.js';
import { PinPrompt } from './components/pin-prompt.js';
import { FOOTER_HINTS, PIN_TEXTS } from './texts.js';

export type { StorySummary };

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
  onAction?: (action: AppAction) => void;
}

type Stage = 'pin' | 'home';

export function App({ projectKey, stories, unlocked = false, unlock, onAction }: AppProps) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>(unlocked ? 'home' : 'pin');
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

  return (
    <Frame projectKey={projectKey} hint={stage === 'pin' ? FOOTER_HINTS.pin : FOOTER_HINTS.home}>
      {stage === 'pin' ? (
        <PinPrompt onSubmit={handlePin} error={pinError} checking={checking} />
      ) : (
        <HomeScreen stories={stories} onRefine={handleRefine} onQuit={exit} />
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
