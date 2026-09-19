/** Some text responses contain literal LF/CR/TAB inside JSON strings.
 * Escape only those characters without changing the decoded text. Do not guess
 * missing quotes/brackets, strip prose, or relax the subsequent JSON.parse.
 */
export function escapeJsonTextWhitespace(value: string): string {
  let quoted = false;
  let escaped = false;
  let result = '';
  for (const char of value) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      else if (char === '\n' || char === '\r' || char === '\t') {
        result += char === '\n' ? '\\n' : char === '\r' ? '\\r' : '\\t';
        continue;
      }
    } else if (char === '"') quoted = true;
    result += char;
  }
  return result;
}
