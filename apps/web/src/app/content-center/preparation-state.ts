export type PreparationStatus =
  "queued" | "processing" | "succeeded" | "failed";

/** Keep the latest server-confirmed state readable beside the run button. */
export function preparationRunLabel(
  status: PreparationStatus,
  error?: string | null,
): string {
  if (status === "queued") return "Задача в очереди";
  if (status === "processing") return "Обрабатываем материалы…";
  if (status === "succeeded") return "Готово — версия доступна в истории";
  return error?.trim()
    ? `Не завершено: ${error}`
    : "Обработка не завершена. Последняя версия сохранена.";
}

export function appendDictation(
  current: string,
  transcript: string,
  limit = 12000,
) {
  const text = transcript.trim();
  if (!text) return { value: current, overflow: false };
  const value = `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`;
  // Keep already entered text intact; do not silently truncate a spoken phrase.
  return value.length <= limit
    ? { value, overflow: false }
    : { value: current, overflow: true };
}

export function speechErrorMessage(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Браузер не разрешил голосовой ввод. Проверьте разрешение микрофона или введите задачу текстом.";
    case "audio-capture":
      return "Микрофон недоступен. Проверьте его подключение и настройки браузера.";
    case "no-speech":
      return "Речь не распознана. Попробуйте ещё раз или введите задачу текстом.";
    case "network":
      return "Сервис распознавания браузера недоступен. Проверьте соединение или введите задачу текстом.";
    case "language-not-supported":
      return "Распознавание русской речи недоступно в этом браузере. Введите задачу текстом.";
    default:
      return "Не удалось выполнить голосовой ввод. Уже введённый текст сохранён в поле; можно продолжить вручную.";
  }
}

export type DictationResult = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};

export function collectDictation(
  results: ArrayLike<DictationResult>,
  committed: Set<number>,
) {
  const final: string[] = [];
  const interim: string[] = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.isFinal && !committed.has(index)) {
      committed.add(index);
      final.push(result[0].transcript);
    } else if (!result.isFinal) interim.push(result[0].transcript);
  }
  return { final: final.join(" "), interim: interim.join(" ").slice(0, 12000) };
}
