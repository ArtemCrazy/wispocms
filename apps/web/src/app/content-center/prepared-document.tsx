import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/(\*\*|__)(?=\S)(.+?\S|\S)\1/g)) {
    parts.push(text.slice(cursor, match.index));
    parts.push(<strong key={match.index}>{match[2]}</strong>);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

// Hide only internal citations, not business URLs, ordinary brackets or saved evidence.
const sourceId = String.raw`S\d+(?:\.\d+)*(?:[ \t]*[-–—][ \t]*S?\d+(?:\.\d+)*)?`;
const sourceGroup = String.raw`\[[ \t]*${sourceId}(?:[ \t]*[,;][ \t]*${sourceId})*[ \t]*\]`;
const sourceReferences = new RegExp(
  String.raw`[ \t]*(?:\([ \t]*${sourceGroup}[ \t]*\)|${sourceGroup})`,
  "g",
);

// Render a deliberately small Markdown subset as React text. Never execute AI HTML.
export function PreparedDocument({
  content,
  hideSourceReferences = false,
}: {
  content: string;
  hideSourceReferences?: boolean;
}) {
  const lines = (
    hideSourceReferences ? content.replace(sourceReferences, "") : content
  ).split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 4)}` as
        "h2" | "h3" | "h4";
      blocks.push(<Tag key={i}>{renderInline(heading[2])}</Tag>);
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
                  <th key={n}>{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell)}</td>
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
            <li key={n}>{renderInline(item)}</li>
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
            <li key={n}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
    } else {
      blocks.push(<p key={i}>{renderInline(line)}</p>);
    }
  }
  return <>{blocks}</>;
}
