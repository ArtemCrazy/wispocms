# Значки типов файлов

Значки в `apps/web/public/icons/files/` взяты без изменений из официального
набора Microsoft Fluent UI File Type Icons (SVG 24 px):
`https://res.cdn.office.net/files/fabric-cdn-prod_20260113.001/assets/item-types/24/`.
Набор опубликован в пакете
[`@fluentui/react-file-type-icons`](https://github.com/microsoft/fluentui/tree/master/packages/react-file-type-icons)
под лицензией MIT. Названия и товарные знаки остаются у владельцев.

Локально хранятся `docx`, `xlsx`, `pptx`, `pdf`, `txt`, `csv`, `photo` и `code`.
Для неизвестных расширений используется копия общего значка `public/file.svg`.
Для `.md` используется `code`, для `.png/.jpg/.jpeg` — `photo`, для вручную
введённого текста — `txt`. Это только представление: содержимое файлов не
изменяется, а загрузка не зависит от Microsoft CDN.
