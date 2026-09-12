import type { ChatReply, ChatTransport } from './types.ts'

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

/** A fixed local scenario, not an LLM response and not a backend integration. */
export const demoTransport: ChatTransport = {
  async send(_messages, signal): Promise<ChatReply> {
    await demoDelay(650, signal)
    return {
      kind: 'answer',
      offerSpecialist: true,
      content:
        'Пример ответа: для оснащения тренировочной группы начните с базового набора: ' +
        'мячи или другой спортивный инвентарь, разметочные конусы, манишки и насос. ' +
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
