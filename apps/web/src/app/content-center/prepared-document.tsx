import type { ReactNode } from "react";

// Render a deliberately small Markdown subset as React text. Never execute AI HTML.
export function PreparedDocument({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 4)}` as
        "h2" | "h3" | "h4";
      blocks.push(<Tag key={i}>{heading[2]}</Tag>);
    } else if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")
    ) {
      const cells = (value: string) =>
        value
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const headers = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(cells(lines[i++]));
      i--;
      blocks.push(
        <div key={i} style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {headers.map((h, n) => (
                  <th key={n}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      i--;
      blocks.push(
        <ul key={i}>
          {items.map((item, n) => (
            <li key={n}>{item}</li>
          ))}
        </ul>,
      );
    } else if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      i--;
      blocks.push(
        <ol key={i}>
          {items.map((item, n) => (
            <li key={n}>{item}</li>
          ))}
        </ol>,
      );
    } else {
      blocks.push(<p key={i}>{line}</p>);
    }
  }
  return <>{blocks}</>;
}
