import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
// Solo tipos: se borra al compilar
import type { ChatBridge, KnowledgeChoice, KnowledgeConnection, KnowledgeSummary } from '../../refinement/chat-types.js';
import { COLORS, HOME_TEXTS, KEYS, KNOWLEDGE_DEFAULT_URL_EXAMPLE, KNOWLEDGE_TEXTS, PIN_MASK } from '../texts.js';
import { KnowledgeBrowser } from './knowledge-browser.js';

interface KnowledgePromptProps {
  chat: ChatBridge;
  onDone: () => void;
  onCancel: () => void;
}

type Step =
  | { name: 'kind' }
  | { name: 'url' }
  | { name: 'key'; url: string }
  | { name: 'trust'; url: string; apiKey: string; pem: string; fingerprint: string }
  | { name: 'root' }
  | { name: 'browse'; connection: KnowledgeConnection };

type Kind = 'mcp' | 'local' | 'none';
const KINDS: Kind[] = ['mcp', 'local', 'none'];

function KindList({ onPick, onCancel }: { onPick: (kind: Kind) => void; onCancel: () => void }) {
  const [selected, setSelected] = useState(0);
  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(KINDS.length - 1, i + 1));
    else if (key.return) onPick(KINDS[selected]);
  });
  return (
    <Box flexDirection="column">
      <Text>{KNOWLEDGE_TEXTS.question}</Text>
      <Text color={COLORS.muted}>{KNOWLEDGE_TEXTS.questionHint}</Text>
      {KINDS.map((kind, index) => (
        <Text key={kind} color={index === selected ? COLORS.brand : undefined}>
          {index === selected ? HOME_TEXTS.selectedMarker : ' '} {KNOWLEDGE_TEXTS.options[kind]}
        </Text>
      ))}
      <Text color={COLORS.muted}>{KNOWLEDGE_TEXTS.kindNextStep}</Text>
    </Box>
  );
}

interface LineInputProps {
  label: string;
  nextStep: string;
  placeholder?: string;
  mask?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function LineInput({ label, nextStep, placeholder, mask, onSubmit, onCancel }: LineInputProps) {
  const [value, setValue] = useState('');
  const [empty, setEmpty] = useState(false);
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
  const submit = (text: string) => {
    if (text.trim() === '') setEmpty(true);
    else onSubmit(text.trim());
  };
  return (
    <Box flexDirection="column">
      <Box>
        <Text>{label}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} placeholder={placeholder} mask={mask} />
      </Box>
      {empty && <Text color={COLORS.error}>{KNOWLEDGE_TEXTS.inputEmpty}</Text>}
      <Text color={COLORS.muted}>{nextStep}</Text>
    </Box>
  );
}

function TrustQuestion({ fingerprint, onAnswer }: { fingerprint: string; onAnswer: (trust: boolean) => void }) {
  useInput((input) => onAnswer(input === KEYS.confirmYes || input === KEYS.confirmYesAlt));
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {KNOWLEDGE_TEXTS.trustTitle}
      </Text>
      <Text>{KNOWLEDGE_TEXTS.trustFingerprint(fingerprint)}</Text>
      <Text>{KNOWLEDGE_TEXTS.trustQuestion}</Text>
      <Text color={COLORS.muted}>{KNOWLEDGE_TEXTS.trustNextStep}</Text>
    </Box>
  );
}

export function KnowledgePrompt({ chat, onDone, onCancel }: KnowledgePromptProps) {
  const [step, setStep] = useState<Step>({ name: 'kind' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (message: string, task: () => Promise<void>, errorText: (m: string) => string) => {
    setBusy(message);
    setError(null);
    try {
      await task();
      return true;
    } catch (err: unknown) {
      setError(errorText((err as Error).message));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = (choice: KnowledgeChoice) =>
    run(
      KNOWLEDGE_TEXTS.saving,
      async () => {
        await chat.saveKnowledge(choice);
        onDone();
      },
      KNOWLEDGE_TEXTS.saveError,
    );

  const pickKind = (kind: Kind) => {
    setError(null);
    if (kind === 'none') void save({ type: 'none' });
    else if (kind === 'mcp') setStep({ name: 'url' });
    else setStep({ name: 'root' });
  };

  const inspect = async (url: string, apiKey: string) => {
    const ok = await run(
      KNOWLEDGE_TEXTS.checking,
      async () => {
        const result = await chat.inspectServer(url);
        if (result.tls === 'system')
          setStep({ name: 'browse', connection: { type: 'mcp', url, apiKey, certPem: null } });
        else setStep({ name: 'trust', url, apiKey, pem: result.pem, fingerprint: result.fingerprint });
      },
      KNOWLEDGE_TEXTS.connectError,
    );
    if (!ok) setStep({ name: 'url' });
  };

  if (busy) return <Text>{busy}</Text>;

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {KNOWLEDGE_TEXTS.title}
      </Text>
      {error && <Text color={COLORS.error}>{error}</Text>}
      {step.name === 'kind' && <KindList onPick={pickKind} onCancel={onCancel} />}
      {step.name === 'url' && (
        <LineInput
          label={KNOWLEDGE_TEXTS.urlLabel}
          placeholder={KNOWLEDGE_DEFAULT_URL_EXAMPLE}
          nextStep={KNOWLEDGE_TEXTS.urlNextStep}
          onSubmit={(url) => setStep({ name: 'key', url })}
          onCancel={onCancel}
        />
      )}
      {step.name === 'key' && (
        <LineInput
          label={KNOWLEDGE_TEXTS.keyLabel}
          mask={PIN_MASK}
          nextStep={KNOWLEDGE_TEXTS.keyNextStep}
          onSubmit={(apiKey) => void inspect(step.url, apiKey)}
          onCancel={onCancel}
        />
      )}
      {step.name === 'trust' && (
        <TrustQuestion
          fingerprint={step.fingerprint}
          onAnswer={(trust) => {
            if (!trust) onCancel();
            else
              setStep({
                name: 'browse',
                connection: { type: 'mcp', url: step.url, apiKey: step.apiKey, certPem: step.pem },
              });
          }}
        />
      )}
      {step.name === 'root' && (
        <LineInput
          label={KNOWLEDGE_TEXTS.rootLabel}
          nextStep={KNOWLEDGE_TEXTS.rootNextStep}
          onSubmit={(root) => setStep({ name: 'browse', connection: { type: 'local', root } })}
          onCancel={onCancel}
        />
      )}
      {step.name === 'browse' && (
        <KnowledgeBrowser
          chat={chat}
          connection={step.connection}
          onSelect={(baseFolder) => void save({ type: 'connect', connection: step.connection, baseFolder })}
          onCancel={onCancel}
        />
      )}
    </Box>
  );
}

// La base viene del .jira.json (quizá de un repo clonado): se muestra a dónde apunta antes de usarla
export function KnowledgeConfirm({ chat, onDone, onCancel }: KnowledgePromptProps) {
  const [summary, setSummary] = useState<KnowledgeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    chat
      .describeKnowledge()
      .then(setSummary)
      .catch((err: Error) => setError(KNOWLEDGE_TEXTS.confirmError(err.message)));
  }, [chat]);
  useInput((input) => {
    if (!summary && !error) return;
    if (summary && (input === KEYS.confirmYes || input === KEYS.confirmYesAlt)) {
      chat
        .trustKnowledge()
        .then(onDone)
        .catch((err: Error) => setError(KNOWLEDGE_TEXTS.saveError(err.message)));
    } else onCancel();
  });
  if (error) return <Text color={COLORS.error}>{error}</Text>;
  if (!summary) return <Text>{KNOWLEDGE_TEXTS.checking}</Text>;
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {KNOWLEDGE_TEXTS.confirmTitle}
      </Text>
      <Text color={COLORS.muted}>{KNOWLEDGE_TEXTS.confirmWarning}</Text>
      <Text>{KNOWLEDGE_TEXTS.confirmType(summary.type)}</Text>
      <Text>{KNOWLEDGE_TEXTS.confirmTarget(summary.type, summary.target)}</Text>
      <Text>{KNOWLEDGE_TEXTS.confirmBase(summary.baseFolder)}</Text>
      <Text>{KNOWLEDGE_TEXTS.confirmQuestion}</Text>
      <Text color={COLORS.muted}>{KNOWLEDGE_TEXTS.confirmNextStep}</Text>
    </Box>
  );
}
