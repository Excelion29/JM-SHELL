import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { ChatBridge, KnowledgeChoice, KnowledgeSettings } from '../../refinement/chat-types.js';
import { KnowledgeBrowser } from '../components/knowledge-browser.js';
import { KnowledgePrompt, LineInput } from '../components/knowledge-prompt.js';
import { COLORS, KEYS, KNOWLEDGE_SETTINGS_TEXTS as T, KNOWLEDGE_TEXTS, PIN_MASK } from '../texts.js';

interface KnowledgeScreenProps {
  chat: ChatBridge;
  // La configuración cambió: el inicio debe releer sus historias
  onChanged: () => void;
  onBack: () => void;
}

type Step = 'menu' | 'base' | 'connect' | 'remove' | 'renew';

const ACTION_KEYS: Record<string, Step> = { '1': 'base', '2': 'connect', '3': 'remove', '4': 'renew' };

function RemoveQuestion({ onAnswer }: { onAnswer: (yes: boolean) => void }) {
  useInput((input) => onAnswer(input === KEYS.confirmYes || input === KEYS.confirmYesAlt));
  return (
    <Box flexDirection="column">
      <Text>{T.removeQuestion}</Text>
      <Text color={COLORS.muted}>{T.removeNextStep}</Text>
    </Box>
  );
}

function SettingsView({ settings }: { settings: KnowledgeSettings }) {
  if (settings.type === 'none') return <Text>{T.noBase}</Text>;
  return (
    <Box flexDirection="column">
      <Text>{T.type(settings.type)}</Text>
      <Text>{T.target(settings.type, settings.target ?? '')}</Text>
      <Text>{T.base(settings.baseFolder ?? '')}</Text>
      <Text>{settings.adrFolder ? T.adr(settings.adrFolder) : T.adrUnknown}</Text>
      {settings.connection === 'ok' ? (
        <Text color={COLORS.accent}>{T.connectionOk}</Text>
      ) : (
        <Text color={COLORS.error}>{T.connectionError(settings.connectionError ?? '')}</Text>
      )}
    </Box>
  );
}

export function KnowledgeScreen({ chat, onChanged, onBack }: KnowledgeScreenProps) {
  const [step, setStep] = useState<Step>('menu');
  const [settings, setSettings] = useState<KnowledgeSettings | null>(null);
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSettings(null);
    chat
      .knowledgeSettings()
      .then((result) => active && setSettings(result))
      .catch((err: Error) => active && setError(T.loadError(err.message)));
    return () => {
      active = false;
    };
  }, [chat, reloads]);

  const backToMenu = () => {
    setStep('menu');
    setReloads((n) => n + 1);
  };

  const apply = async (choice: KnowledgeChoice, done: string) => {
    const result = await chat.changeKnowledge(choice);
    const left = result.leftBehind;
    setMessage(done);
    setNote(left ? (result.movesOnOpen ? T.movesOnOpen(left) : T.leftBehind(left)) : null);
    onChanged();
  };

  const run = async (busyText: string, task: () => Promise<void>, errorText: (m: string) => string) => {
    setBusy(busyText);
    setError(null);
    setMessage(null);
    setNote(null);
    try {
      await task();
    } catch (err: unknown) {
      setError(errorText((err as Error).message));
    } finally {
      setBusy(null);
      backToMenu();
    }
  };

  const pick = (next: Step) => {
    setError(null);
    setMessage(null);
    setNote(null);
    if (!settings) return;
    if (next === 'renew' && settings.type !== 'mcp') setError(T.renewNeedsMcp);
    else if ((next === 'base' || next === 'remove') && settings.type === 'none') setError(T.needsBase);
    else setStep(next);
  };

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      else if (ACTION_KEYS[input]) pick(ACTION_KEYS[input]);
    },
    { isActive: step === 'menu' && !busy },
  );

  if (busy) return <Text>{busy}</Text>;

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {T.title}
      </Text>
      {step === 'menu' && (
        <Box flexDirection="column">
          {message && <Text color={COLORS.brand}>{message}</Text>}
          {note && <Text color={COLORS.brand}>{note}</Text>}
          {error && <Text color={COLORS.error}>{error}</Text>}
          {!settings && !error && <Text>{T.loading}</Text>}
          {settings && <SettingsView settings={settings} />}
          {settings && (
            <Box flexDirection="column">
              {Object.values(T.actions).map((action) => (
                <Text key={action}>{action}</Text>
              ))}
            </Box>
          )}
          <Text color={COLORS.muted}>{T.nextStep}</Text>
        </Box>
      )}
      {step === 'base' && (
        <KnowledgeBrowser
          chat={chat}
          connection={{ type: 'current' }}
          onSelect={(baseFolder) =>
            void run(
              KNOWLEDGE_TEXTS.saving,
              () => apply({ type: 'connect', connection: { type: 'current' }, baseFolder }, T.changed),
              KNOWLEDGE_TEXTS.saveError,
            )
          }
          onCancel={backToMenu}
        />
      )}
      {step === 'connect' && (
        <KnowledgePrompt
          chat={chat}
          save={(choice) => apply(choice, choice.type === 'none' ? T.removed : T.changed)}
          onDone={backToMenu}
          onCancel={backToMenu}
        />
      )}
      {step === 'remove' && (
        <RemoveQuestion
          onAnswer={(yes) => {
            if (yes)
              void run(KNOWLEDGE_TEXTS.saving, () => apply({ type: 'none' }, T.removed), KNOWLEDGE_TEXTS.saveError);
            else backToMenu();
          }}
        />
      )}
      {step === 'renew' && (
        <LineInput
          label={T.renewLabel}
          mask={PIN_MASK}
          nextStep={T.renewNextStep}
          onSubmit={(apiKey) =>
            void run(
              T.renewing,
              async () => {
                await chat.renewKnowledgeKey(apiKey);
                setMessage(T.renewed);
              },
              T.renewError,
            )
          }
          onCancel={backToMenu}
        />
      )}
    </Box>
  );
}
