import { GlobalConfig } from '../config/types';

let _session: GlobalConfig | null = null;
// El PIN solo vive en memoria mientras la app está abierta: cifra la API key de la base de conocimiento
let _pin: string | null = null;

export function setSession(config: GlobalConfig): void {
  _session = config;
}

export function getSession(): GlobalConfig | null {
  return _session;
}

export function setSessionPin(pin: string): void {
  _pin = pin;
}

export function getSessionPin(): string | null {
  return _pin;
}

export function clearSession(): void {
  _session = null;
  _pin = null;
}
