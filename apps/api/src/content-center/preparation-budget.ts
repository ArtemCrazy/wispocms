import { AiProviderError } from '../ai/ai-provider.error';
import type { PreparationInput } from './preparation-ai.service';

export const PREPARATION_REQUEST_LIMIT = 60_000;
export const PREPARATION_BATCH_TARGET = 45_000;
type Materials = PreparationInput['materials'];
type Measure = (instruction: string, context: PreparationInput) => number;

/** Conservative character budget of both messages, including JSON escaping and framing.
 * Not a token limit. Adapters with a different system prompt must measure their own input.
 */
export function preparationRequestSize(
  instruction: string,
  context: PreparationInput,
  system = ' '.repeat(2_000),
): number {
  return JSON.stringify([
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ instruction, context }) },
  ]).length;
}

function boundary(text: string, start: number, end: number) {
  if (end === text.length) return end;
  const floor = start + Math.floor((end - start) * 0.6);
  const tail = text.slice(floor, end);
  // Prefer complete paragraphs, then lines/table rows, sentences, and words.
  for (const pattern of [/\n\s*\n/g, /\n/g, /[.!?…][ \t]+/g, /\s+/g]) {
    const matches = [...tail.matchAll(pattern)];
    const last = matches.at(-1);
    if (last) return floor + last.index + last[0].length;
  }
  // A single oversized unbroken block must still be bounded, without corrupting Unicode.
  if (
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  )
    end--;
  return end;
}

export function preparationBatches(
  materials: Materials,
  instruction: string,
  measure: Measure,
): Materials[] {
  const fits = (batch: Materials) =>
    measure(instruction, { materials: batch, previousResult: null }) <=
    PREPARATION_REQUEST_LIMIT;
  const parts: Materials = [];
  for (const material of materials) {
    if (
      material.content.length <= PREPARATION_BATCH_TARGET &&
      fits([material])
    ) {
      parts.push(material);
      continue;
    }
    let offset = 0;
    let number = 0;
    while (offset < material.content.length) {
      const part = {
        ...material,
        title: `${material.title} (часть ${++number})`,
      };
      let low = 0,
        high = Math.min(
          PREPARATION_BATCH_TARGET,
          material.content.length - offset,
        );
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (
          fits([
            {
              ...part,
              content: material.content.slice(offset, offset + middle),
            },
          ])
        )
          low = middle;
        else high = middle - 1;
      }
      const end = boundary(material.content, offset, offset + low);
      if (end <= offset)
        throw new AiProviderError(
          'Задача или описание источника не помещается в безопасный объём запроса. Сократите задачу.',
        );
      parts.push({ ...part, content: material.content.slice(offset, end) });
      offset = end;
    }
    if (!material.content.length)
      throw new AiProviderError(
        'Описание источника превышает безопасный объём запроса.',
      );
  }
  const batches: Materials[] = [];
  for (const part of parts) {
    const last = batches.at(-1);
    if (
      last &&
      last.reduce(
        (sum, item) => sum + item.content.length,
        part.content.length,
      ) <= PREPARATION_BATCH_TARGET &&
      fits([...last, part])
    )
      last.push(part);
    else batches.push([part]);
  }
  return batches;
}
