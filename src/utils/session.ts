import { GlobalConfig } from '../config/types';

let _session: GlobalConfig | null = null;

export function setSession(config: GlobalConfig): void {
  _session = config;
}

export function getSession(): GlobalConfig | null {
  return _session;
}

export function clearSession(): void {
  _session = null;
}
