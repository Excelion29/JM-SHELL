// Parte el texto en filas de a lo sumo `width` caracteres, respetando los saltos de línea
export function wrapText(text: string, width: number): string[] {
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let rest = paragraph;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(' ', width);
      const at = cut > 0 ? cut : width;
      rows.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    rows.push(rest);
  }
  return rows;
}

export const expandTabs = (text: string, tabWidth: number): string => text.replace(/\t/g, ' '.repeat(tabWidth));

// Últimas `max` filas y cuántas quedaron arriba sin mostrar
export function clipRows(rows: string[], max: number): { shown: string[]; hidden: number } {
  const hidden = Math.max(0, rows.length - max);
  return { shown: rows.slice(hidden), hidden };
}
