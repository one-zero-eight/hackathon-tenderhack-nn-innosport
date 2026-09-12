import { LuMessageSquareText } from 'react-icons/lu'
import { getFeedbackContext } from '@/features/admin/model'
import type { AdminAppeal } from '@/features/admin/types'
import type { FeedbackRating } from '@/features/chat/types'

const ratingLabels: Record<FeedbackRating, string> = {
  complete: 'Ответил полностью',
  partial: 'Неполный ответ',
  irrelevant: 'Ответ нерелевантен',
}

export default function AdminFeedbackPanel({ appeal }: { appeal: AdminAppeal }) {
  const feedback = appeal.chat.feedback
  const context = getFeedbackContext(appeal.chat)

  return (
    <aside aria-labelledby="admin-feedback-title" className="border-border bg-surface flex min-h-0 flex-col overflow-hidden rounded-2xl border">
      <header className="border-border border-b px-5 py-4">
        <h2 id="admin-feedback-title" className="text-ui-title font-semibold">
          Фидбек
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!feedback ? (
          <div className="text-foreground/50 flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <LuMessageSquareText className="size-6" />
            <p>Пользователь не оставил оценку</p>
          </div>
        ) : (
          <dl className="space-y-6">
            <div>
              <dt className="text-ui-small text-foreground/45 mb-2">Фидбек пользователя</dt>
              <dd className="font-medium">{ratingLabels[feedback.rating]}</dd>
              {feedback.comment && <dd className="text-foreground/70 mt-2 break-words whitespace-pre-wrap">{feedback.comment}</dd>}
            </div>
            <div className="border-border border-t pt-5">
              <dt className="text-ui-small text-foreground/45 mb-2">Запрос пользователя</dt>
              <dd className="leading-7 break-words whitespace-pre-wrap">{context?.request.content ?? 'Контекст запроса недоступен'}</dd>
            </div>
            <div className="border-border border-t pt-5">
              <dt className="text-ui-small text-foreground/45 mb-2">Ответ агента</dt>
              <dd className="leading-7 break-words whitespace-pre-wrap">{context?.answer.content ?? 'Контекст ответа недоступен'}</dd>
            </div>
          </dl>
        )}
      </div>
    </aside>
  )
}
