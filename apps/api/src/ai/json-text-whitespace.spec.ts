import { escapeJsonTextWhitespace } from './json-text-whitespace';

describe('literal whitespace in AI JSON text', () => {
  it('preserves literal line breaks and tabs exactly as decoded text', () => {
    const text = 'Факт (описание)\n\nИсточник\r\nСтрока\tЗначение';
    expect(
      JSON.parse(escapeJsonTextWhitespace('{"content":"' + text + '"}')),
    ).toEqual({ content: text });
  });
  it('leaves valid escaping, Unicode and structural whitespace unchanged', () => {
    const json =
      '\n' +
      JSON.stringify(
        { content: '"цена" \\ путь\n😀\t\r\n', another: 'literal \\n' },
        null,
        2,
      ) +
      '\n';
    expect(escapeJsonTextWhitespace(json)).toBe(json);
  });
  it.each([
    '{"content":"unfinished\n',
    '{"content":"unescaped "quote"\n"}',
    '{"content":"bad\\q\n"}',
    '{"content":"nul\0\n"}',
    '{"content":"line\\\ncontinuation"}',
    '```json\n{"content":"Text"}\n```',
    '{"content":"Text"} extra',
  ])('does not repair other malformed JSON', (value) => {
    expect(() => JSON.parse(escapeJsonTextWhitespace(value))).toThrow();
  });
});
