import { createElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Render assistant Markdown without executing raw HTML or loading remote images. */
export default function MarkdownMessage({ content }: { content: string }) {
  return createElement(
    'div',
    {
      className:
        'text-ui-body text-foreground/85 min-w-0 leading-7 break-words [overflow-wrap:anywhere] ' +
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ' +
        '[&_p]:my-3 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold ' +
        '[&_h2]:mt-5 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold ' +
        '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold ' +
        '[&_h4]:mt-4 [&_h4]:font-semibold [&_h5]:mt-3 [&_h5]:font-semibold [&_h6]:mt-3 [&_h6]:font-semibold ' +
        '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 ' +
        '[&_li>ul]:my-1 [&_li>ol]:my-1 [&_strong]:font-semibold ' +
        '[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-foreground/65 ' +
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80 [&_a]:focus-visible:outline-2 ' +
        '[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm ' +
        '[&_pre]:my-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-2 [&_pre]:p-4 ' +
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre ' +
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left ' +
        '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_hr]:my-5 [&_hr]:border-border ' +
        '[&_input]:mr-2 [&_input]:accent-primary [&_.contains-task-list]:list-none',
    },
    createElement(ReactMarkdown, {
      children: content,
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      disallowedElements: ['img'],
      components: {
        a: ({ href, children }) => createElement('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children),
        table: ({ children }) => createElement('div', { className: 'my-4 max-w-full overflow-x-auto', tabIndex: 0, role: 'region', 'aria-label': 'Таблица в ответе' }, createElement('table', null, children)),
      },
    }),
  )
}
