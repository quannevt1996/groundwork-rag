/**
 * Builds a minimal, valid PDF with one text page per entry in `pages`, using the
 * built-in Helvetica font. Enough for parser tests and for generating the sample
 * PDFs without a PDF library. Text must be ASCII (WinAnsi) to round-trip.
 */
export function makePdf(pages: string[], opts: { title?: string; fontSize?: number; wrapAt?: number } = {}): Uint8Array {
  const fontSize = opts.fontSize ?? 10.5;
  const wrapAt = opts.wrapAt ?? 95;
  const leading = Math.round(fontSize * 1.4);

  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number

  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesObj = add(""); // filled in once the page objects exist
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  const pageRefs: number[] = [];
  for (const text of pages) {
    const lines = text.split("\n").flatMap((line) => wrap(line, wrapAt));
    const ops = lines.map((line) => (line ? `(${escapePdfString(line)}) Tj T*` : "T*")).join("\n");
    const stream = `BT\n/F1 ${fontSize} Tf\n${leading} TL\n72 740 Td\n${ops}\nET`;
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  const info = opts.title ? add(`<< /Title (${escapePdfString(opts.title)}) >>`) : null;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function escapePdfString(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && current.length + word.length + 1 > width) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}
