import React, { useState } from 'react';
import { render, useApp, useInput } from 'ink';
import { Frame } from './components/frame.js';
import { HomeScreen } from './components/home-screen.js';
import { PinPrompt } from './components/pin-prompt.js';
import { FOOTER_HINTS, KEYS, PIN_TEXTS } from './texts.js';

export interface UnlockResult {
  ok: boolean;
  message?: string;
}

export interface AppProps {
  projectKey: string | null;
  unlock: (pin: string) => Promise<UnlockResult>;
}

type Stage = 'pin' | 'home';

export function App({ projectKey, unlock }: AppProps) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>('pin');
  const [checking, setChecking] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useInput((input) => {
    if (stage === 'home' && input === KEYS.quit) exit();
  });

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

  return (
    <Frame projectKey={projectKey} hint={stage === 'pin' ? FOOTER_HINTS.pin : FOOTER_HINTS.home}>
      {stage === 'pin' ? <PinPrompt onSubmit={handlePin} error={pinError} checking={checking} /> : <HomeScreen />}
    </Frame>
  );
}

export async function runApp(props: AppProps): Promise<void> {
  const instance = render(<App {...props} />);
  await instance.waitUntilExit();
}
