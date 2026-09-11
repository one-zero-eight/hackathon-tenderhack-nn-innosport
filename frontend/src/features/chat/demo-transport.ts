import type { ChatReply, ChatTransport, ClarificationRequest } from './types.ts'

/** A fixed local scenario, not an LLM response and not a backend integration. */
const DEMO_ROUNDS: readonly Omit<ClarificationRequest, 'id'>[] = [
  {
    question: 'Для какого вида спорта нужен инвентарь?',
    options: [
      { id: 'football', label: 'Футбол' },
      { id: 'basketball', label: 'Баскетбол' },
      { id: 'fitness', label: 'Фитнес' },
    ],
  },
  {
    question: 'Кто будет пользоваться оборудованием?',
    options: [
      { id: 'children', label: 'Дети и подростки' },
      { id: 'amateurs', label: 'Взрослые любители' },
      { id: 'professionals', label: 'Профессиональные спортсмены' },
    ],
    multiple: true,
  },
  {
    question: 'Какой бюджет закупки вы планируете?',
    options: [
      { id: 'small', label: 'До 100 000 ₽' },
      { id: 'medium', label: 'От 100 000 до 500 000 ₽' },
      { id: 'large', label: 'Более 500 000 ₽' },
    ],
  },
]

function abortError(): DOMException {
  return new DOMException('The demo request was aborted', 'AbortError')
}

/** Exported for deterministic tests and alternate demo pacing. */
export function demoDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const demoTransport: ChatTransport = {
  async send(messages, signal): Promise<ChatReply> {
    await demoDelay(650, signal)
    const count = new Set(messages.filter((message) => message.role === 'user' && message.clarificationId).map((message) => message.clarificationId)).size
    const round = DEMO_ROUNDS[count]
    if (round) {
      const firstUserId = messages.find((message) => message.role === 'user')?.id ?? 'start'
      return {
        kind: 'clarification',
        content: count === 0 ? 'Это демонстрационный сценарий. Давайте уточним запрос в три шага.' : 'Ответ принят в демо-сценарии. Уточним следующий параметр.',
        clarification: { ...round, id: `demo:${firstUserId}:${count + 1}` },
      }
    }
    return {
      kind: 'answer',
      content:
        'Пример ответа: для оснащения тренировочной группы начните с базового набора: ' +
        'мячи или другой инвентарь выбранного вида спорта, разметочные конусы, манишки и насос. ' +
        'Для детей выбирайте размер и вес по возрасту, для регулярных занятий — износостойкие материалы. ' +
        'В закупке отдельно укажите количество участников, условия использования и требования к безопасности; ' +
        'часть бюджета оставьте на хранение и замену расходных материалов. ' +
        'Это пример рекомендации из локального демо-сценария, не подбор конкретных товаров: ' +
        'поиск товаров, обращение к LLM и отправка данных на сервер не выполнялись.',
    }
  },
  async requestSpecialist(chat, signal) {
    await demoDelay(650, signal)
    return {
      specialistType: 'подбору спортивного инвентаря',
      requestId: `demo-specialist:${chat.id}:${globalThis.crypto.randomUUID()}`,
      simulated: true,
    }
  },
}
