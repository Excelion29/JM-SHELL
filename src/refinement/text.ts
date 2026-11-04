const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

// Texto leído de .jm puede traer secuencias de escape de terminal: se descartan antes de mostrarlo
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, '');
}

// OSC (incluye hipervínculos OSC 8 y portapapeles OSC 52), DCS/APC/PM/SOS, CSI y cualquier otro ESC suelto
const ESCAPE_SEQUENCES =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[P^_X][^\x1b]*(?:\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]?|\x9b[0-?]*[ -/]*[@-~]?|\x1b[@-Z\\-_]?/g;
const NON_TEXT_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

// Texto del asistente para pintar en la terminal: conserva \n y \t, quita toda secuencia de control
export function stripTerminalControls(text: string): string {
  return text.replace(ESCAPE_SEQUENCES, '').replace(NON_TEXT_CONTROLS, '');
}
