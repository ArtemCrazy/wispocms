export type NotFoundTemplate = {
  key: string;
  version: string;
  name: string;
  description: string;
  eyebrow: string;
  code: string;
  title: string;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
  tone: 'violet' | 'lime';
  alignment: 'center' | 'left';
  visual: 'orbit' | 'grid';
};

export const DEFAULT_NOT_FOUND_TEMPLATE_KEY = 'signal';
export const DEFAULT_NOT_FOUND_TEMPLATE_VERSION = '1';

export const NOT_FOUND_TEMPLATES: readonly NotFoundTemplate[] = [
  {
    key: DEFAULT_NOT_FOUND_TEMPLATE_KEY,
    version: DEFAULT_NOT_FOUND_TEMPLATE_VERSION,
    name: 'Сигнал',
    description: 'Контрастный экран с крупным кодом ошибки и мягкой графикой.',
    eyebrow: 'Ошибка навигации',
    code: '404',
    title: 'Страница не найдена',
    text: 'Похоже, такой страницы больше нет или адрес введён неверно.',
    buttonLabel: 'Вернуться на главную',
    buttonUrl: '/',
    tone: 'violet',
    alignment: 'center',
    visual: 'orbit',
  },
  {
    key: 'editorial',
    version: '1',
    name: 'Редакция',
    description: 'Спокойная журнальная композиция для контентных проектов.',
    eyebrow: 'Материал не найден',
    code: '404',
    title: 'Здесь пока ничего нет',
    text: 'Перейдите на главную — там собраны свежие публикации и важные материалы.',
    buttonLabel: 'К последним материалам',
    buttonUrl: '/',
    tone: 'lime',
    alignment: 'left',
    visual: 'grid',
  },
  {
    key: 'skinova',
    version: '1',
    name: 'Skinova',
    description: 'Светлая редакционная страница в визуальной системе Skinova.',
    eyebrow: 'Ошибка навигации',
    code: '404',
    title: 'Страница не найдена',
    text: 'Похоже, такой страницы больше нет или адрес введён неверно.',
    buttonLabel: 'Вернуться на главную',
    buttonUrl: '/',
    tone: 'violet',
    alignment: 'left',
    visual: 'grid',
  },
] as const;

export function getNotFoundTemplate(
  key?: string | null,
  version?: string | null,
) {
  return (
    NOT_FOUND_TEMPLATES.find(
      (template) => template.key === key && template.version === version,
    ) ?? NOT_FOUND_TEMPLATES[0]
  );
}
