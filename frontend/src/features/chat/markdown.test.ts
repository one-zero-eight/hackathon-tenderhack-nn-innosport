/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownMessage from '../../components/chat/MarkdownMessage.ts'

const render = (content: string) => renderToStaticMarkup(createElement(MarkdownMessage, { content }))

test('assistant Markdown renders headings, emphasis, lists, quotes and code', () => {
  const html = render('# Ответ\n\n**Важно** и *подробности*.\n\n- Первый\n- Второй\n\n1. Шаг\n\n> Цитата\n\n`код`\n\n```js\nconst n = 1 < 2\n```')
  for (const fragment of ['<h1>Ответ</h1>', '<strong>Важно</strong>', '<em>подробности</em>', '<ul>', '<ol>', '<li>Первый</li>', '<blockquote>', '<code>код</code>', '<pre><code class="language-js">', '1 &lt; 2'])
    assert.ok(html.includes(fragment), fragment)
})

test('supports GFM tables, task lists, strikethrough and safe links', () => {
  const html = render('| Поле | Значение |\n| --- | --- |\n| Статус | Открыто |\n\n- [x] Готово\n\n~~Удалено~~\n\n[Ссылка](https://example.com)')
  for (const fragment of ['<table>', '<th>Поле</th>', '<td>Открыто</td>', 'type="checkbox"', 'disabled=""', '<del>Удалено</del>', 'href="https://example.com"', 'rel="noopener noreferrer"']) assert.ok(html.includes(fragment), fragment)
})

test('does not execute HTML, allow unsafe link protocols or load remote images', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[Опасная ссылка](javascript:alert%281%29)\n\n![Трекер](https://example.com/pixel.png)\n\n[Данные](data:text/html,test)')
  assert.doesNotMatch(html, /<script|<img|onerror=|href="javascript:|href="data:/)
  assert.ok(html.includes('Опасная ссылка'))
})
