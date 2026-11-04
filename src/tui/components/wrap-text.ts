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
