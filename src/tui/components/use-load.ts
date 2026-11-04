import { useEffect, useState } from 'react';

export type LoadState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

export function useLoad<T>(load: () => Promise<T>): { state: LoadState<T>; retry: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // load cambia en cada render: solo reintentar re-dispara la carga
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    Promise.resolve()
      .then(load)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
