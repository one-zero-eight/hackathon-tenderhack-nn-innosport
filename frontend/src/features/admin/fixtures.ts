import type { AdminAppeal } from './types'

export const adminAppeals: AdminAppeal[] = [
  {
    userId: 'user-1042',
    chat: {
      id: 'appeal-browser-access',
      title: 'Не открывается личный кабинет',
      updatedAt: '2026-09-12T09:34:00.000Z',
      status: 'closed',
      closedAt: '2026-09-12T09:34:00.000Z',
      feedbackDismissed: false,
      feedback: {
        rating: 'partial',
        comment: 'Инструкция помогла, но пришлось самостоятельно искать настройки браузера.',
        submittedAt: '2026-09-12T09:35:00.000Z',
      },
      messages: [
        { id: 'browser-u1', role: 'user', content: 'Не могу открыть личный кабинет поставщика.', createdAt: '2026-09-12T09:20:00.000Z' },
        {
          id: 'browser-a1',
          role: 'assistant',
          kind: 'clarification',
          content: 'Уточните, пожалуйста, что происходит после входа.',
          createdAt: '2026-09-12T09:20:00.000Z',
          clarification: {
            id: 'browser-question',
            question: 'Что отображается после авторизации?',
            options: [
              { id: 'blank', label: 'Пустая страница' },
              { id: 'error', label: 'Сообщение об ошибке' },
              { id: 'loading', label: 'Бесконечная загрузка' },
            ],
          },
        },
        { id: 'browser-u2', role: 'user', content: 'Бесконечная загрузка в Firefox.', clarificationId: 'browser-question', createdAt: '2026-09-12T09:23:00.000Z' },
        {
          id: 'browser-a2',
          role: 'assistant',
          kind: 'answer',
          content: 'Очистите данные сайта в настройках Firefox, затем отключите блокировщик содержимого для страницы и войдите повторно. Если загрузка продолжится, откройте кабинет в приватном окне и приложите код ошибки из консоли.',
          createdAt: '2026-09-12T09:24:00.000Z',
        },
        { id: 'browser-closed', role: 'assistant', kind: 'notice', content: 'Обращение закрыто.', createdAt: '2026-09-12T09:34:00.000Z' },
      ],
    },
  },
  {
    userId: 'user-2088',
    chat: {
      id: 'appeal-accreditation',
      title: 'Документы для аккредитации',
      updatedAt: '2026-09-12T10:18:00.000Z',
      status: 'open',
      feedbackDismissed: false,
      handoff: {
        requestId: 'handoff-2088',
        specialistType: 'аккредитации поставщиков',
        simulated: false,
        createdAt: '2026-09-12T10:18:00.000Z',
      },
      feedback: {
        rating: 'complete',
        comment: '',
        submittedAt: '2026-09-12T10:19:00.000Z',
      },
      messages: [
        { id: 'accreditation-u1', role: 'user', content: 'Какие документы нужны для аккредитации?', createdAt: '2026-09-12T10:05:00.000Z' },
        {
          id: 'accreditation-a1',
          role: 'assistant',
          kind: 'answer',
          content: 'Подготовьте выписку из ЕГРЮЛ, уставные документы, доверенность представителя и банковские реквизиты. Файлы необходимо загрузить в формате PDF в разделе «Аккредитация».',
          createdAt: '2026-09-12T10:06:00.000Z',
        },
        { id: 'accreditation-u2', role: 'user', content: 'Нужна ли электронная подпись?', createdAt: '2026-09-12T10:10:00.000Z' },
        {
          id: 'accreditation-a2',
          role: 'assistant',
          kind: 'answer',
          content: 'Да, заявление на аккредитацию необходимо подписать усиленной квалифицированной электронной подписью руководителя или уполномоченного представителя.',
          createdAt: '2026-09-12T10:11:00.000Z',
        },
        { id: 'accreditation-handoff', role: 'assistant', kind: 'handoff', content: 'Специалист по аккредитации поставщиков скоро свяжется с Вами', createdAt: '2026-09-12T10:18:00.000Z' },
      ],
    },
  },
  {
    userId: 'user-3175',
    chat: {
      id: 'appeal-contract',
      title: 'Изменение данных договора',
      updatedAt: '2026-09-12T11:42:00.000Z',
      status: 'open',
      feedbackDismissed: false,
      messages: [
        { id: 'contract-u1', role: 'user', content: 'Как изменить реквизиты в уже опубликованном договоре?', createdAt: '2026-09-12T11:40:00.000Z' },
        {
          id: 'contract-a1',
          role: 'assistant',
          kind: 'clarification',
          content: 'Сначала нужно определить тип реквизитов и текущий статус договора.',
          createdAt: '2026-09-12T11:41:00.000Z',
          clarification: {
            id: 'contract-question',
            question: 'Какие реквизиты необходимо изменить?',
            options: [
              { id: 'bank', label: 'Банковские реквизиты' },
              { id: 'legal', label: 'Юридический адрес' },
              { id: 'contact', label: 'Контактные данные' },
            ],
          },
        },
      ],
    },
  },
]
