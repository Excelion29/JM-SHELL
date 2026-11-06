import type { JiraService } from '../services/jira';
import type { CloseFileView, ClosePreview, CloseResult } from './review-types';
import { attachmentStoreName, listLocalEntries, readAttachment } from './review';
import { readState, transitionPhase } from './state';
import type { StoryStore } from './story-store';
import { StoryAttachment } from './types';

const CLOSABLE_PHASES: readonly string[] = ['created', 'in-progress'];

export type CloseJira = Pick<JiraService, 'getAttachments'>;

export const CLOSE_REASONS = {
  analysis: 'solo era para el análisis',
  verified: (issueKey: string) => `verificado en ${issueKey} (mismo nombre y tamaño)`,
  neverUploaded: 'no se subió a ningún issue',
  unverified: (issueKey: string, detail: string) => `no pude verificarlo en ${issueKey}: ${detail}`,
  untracked: 'no tiene propósito registrado',
  notConfirmed: 'no se confirmó',
} as const;

// Jira guarda el nombre tal como se subió y el tamaño en bytes: con ambos coincidiendo el archivo está a salvo
async function verifiedIn(
  jira: CloseJira,
  entry: StoryAttachment,
  size: number,
  cache: Map<string, Promise<Array<{ filename: string; size: number }>>>,
): Promise<{ issueKey: string } | { failure: string }> {
  const failures: string[] = [];
  for (const issueKey of Object.keys(entry.uploaded)) {
    if (!cache.has(issueKey)) cache.set(issueKey, jira.getAttachments(issueKey));
    try {
      const remote = await (cache.get(issueKey) as Promise<Array<{ filename: string; size: number }>>);
      if (remote.some((r) => r.filename === entry.file && r.size === size)) return { issueKey };
      failures.push(CLOSE_REASONS.unverified(issueKey, 'no aparece con el mismo nombre y tamaño'));
    } catch (err: unknown) {
      failures.push(CLOSE_REASONS.unverified(issueKey, (err as Error).message));
    }
  }
  return { failure: failures[0] ?? CLOSE_REASONS.neverUploaded };
}

// La bóveda no da tamaños en el listado: se leen una vez y se recuerdan entre la vista previa y el borrado
const SIZE_CACHE_TTL_MS = 10 * 60 * 1000;
const vaultSizes = new WeakMap<StoryStore, { at: number; sizes: Map<string, number> }>();

function vaultSizeCache(store: StoryStore): Map<string, number> {
  const cached = vaultSizes.get(store);
  if (cached && Date.now() - cached.at < SIZE_CACHE_TTL_MS) return cached.sizes;
  const fresh = { at: Date.now(), sizes: new Map<string, number>() };
  vaultSizes.set(store, fresh);
  return fresh.sizes;
}

async function sizeOf(store: StoryStore, file: string, listed: number | undefined): Promise<number> {
  if (listed !== undefined) return listed;
  const cache = vaultSizeCache(store);
  const known = cache.get(file);
  if (known !== undefined) return known;
  const size = (await readAttachment(store, file)).length;
  cache.set(file, size);
  return size;
}

export async function prepareClose(jira: CloseJira, store: StoryStore, key: string): Promise<ClosePreview> {
  const state = await readState(store, key);
  if (!state) throw new Error(`La historia ${key} aún no tiene estado.`);
  if (!CLOSABLE_PHASES.includes(state.phase)) {
    throw new Error(`${key} está en fase "${state.phase}": solo se cierran historias con tareas creadas.`);
  }
  const deletable: CloseFileView[] = [];
  const kept: CloseFileView[] = [];
  const cache = new Map<string, Promise<Array<{ filename: string; size: number }>>>();

  for (const { name: file, size: listedSize } of await listLocalEntries(store)) {
    const entry = state.attachments.find((a) => a.file === file);
    if (!entry) {
      kept.push({ file, reason: CLOSE_REASONS.untracked });
    } else if (entry.purpose === 'analysis') {
      deletable.push({ file, reason: CLOSE_REASONS.analysis });
    } else {
      const verdict = await verifiedIn(jira, entry, await sizeOf(store, file, listedSize), cache);
      if ('issueKey' in verdict) deletable.push({ file, reason: CLOSE_REASONS.verified(verdict.issueKey) });
      else kept.push({ file, reason: verdict.failure });
    }
  }
  return { deletable, kept };
}

// Se vuelve a verificar al borrar: solo se elimina lo que sigue siendo borrable y el dev confirmó
export async function executeClose(
  jira: CloseJira,
  store: StoryStore,
  key: string,
  confirmed: string[],
): Promise<CloseResult> {
  const preview = await prepareClose(jira, store, key);
  const allowed = new Set(preview.deletable.map((d) => d.file));
  const deleted: string[] = [];
  for (const file of confirmed.filter((f) => allowed.has(f))) {
    try {
      await store.remove(attachmentStoreName(file));
    } catch (err: unknown) {
      throw new Error(`No pude borrar ${file}: ${(err as Error).message}`);
    }
    deleted.push(file);
  }
  await transitionPhase(store, key, 'closed');
  const notDeleted = preview.kept.concat(
    preview.deletable
      .filter((d) => !deleted.includes(d.file))
      .map((d) => ({ file: d.file, reason: CLOSE_REASONS.notConfirmed })),
  );
  return { deleted, kept: notDeleted };
}
