const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

// Texto leído de .jdf puede traer secuencias de escape de terminal: se descartan antes de mostrarlo
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, '');
}
