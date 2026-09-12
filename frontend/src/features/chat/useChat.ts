import { useCallback, useEffect, useRef, useState } from 'react'
import { demoTransport } from './demo-transport.ts'
import type { SchemaDialogListItem, SchemaDialogView } from '@/api/types'
import { mergeRemoteDialog, mergeRemoteList } from './dialog-map.ts'
import { applyExchange, applySpecialistHandoff, canContactSpecialist, canFeedback, CHAT_STORAGE_KEY, CHAT_STORAGE_VERSION, clarificationCount, closeChat as closeChatModel, createChat, dismissFeedback as dismissFeedbackModel, formatClarificationAnswer, isChatReply, isSpecialistResponse, parseChatHistory, pendingClarification, reopenChat as reopenChatModel, serializeChatHistory, submitFeedback as submitFeedbackModel } from './model.ts'
import type { ChatHistory } from './model.ts'
import type { Chat, ChatMessage, ChatTransport, ClarificationAnswer, ClarificationRequest, FeedbackRating } from './types.ts'

let fallbackId = 0
function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${++fallbackId}`
}

function loadHistory(): ChatHistory {
  try {
    const saved = parseChatHistory(window.localStorage.getItem(CHAT_STORAGE_KEY))
    if (saved) return saved
  } catch {
    // Privacy settings, unavailable storage, and SSR all use in-memory history.
  }
  const chat = createChat(newId(), new Date().toISOString())
  return { version: CHAT_STORAGE_VERSION, chats: [chat], activeChatId: chat.id }
}

export interface UseChatResult {
  chats: Chat[]
  activeChat: Chat
  activeChatId: string
  drafts: Record<string, string>
  draft: string
  setDraft: (text: string) => void
  createChat: () => Chat | Promise<Chat>
  selectChat: (id: string) => void
  syncList: (items: readonly SchemaDialogListItem[]) => void
  syncDialog: (view: SchemaDialogView) => void
  send: (text: string) => Promise<boolean>
  answer: (request: ClarificationRequest, answer: ClarificationAnswer) => Promise<boolean>
  closeChat: () => void
  reopenChat: () => void
  contactSpecialist: () => Promise<boolean>
  submitFeedback: (rating: FeedbackRating, comment: string) => boolean
  dismissFeedback: () => void
  canFeedback: boolean
  canContactSpecialist: boolean
  busy: boolean
  error: string | null
  clarificationCount: number
  pendingClarification: ClarificationRequest | undefined
}

export function useChat(transport: ChatTransport = demoTransport): UseChatResult {
  const [history, setHistory] = useState(loadHistory)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyChats, setBusyChats] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const historyRef = useRef(history)
  const draftsRef = useRef(drafts)
  const operations = useRef(new Map<string, AbortController>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const pending = operations.current
    return () => {
      mounted.current = false
      for (const controller of pending.values()) controller.abort()
      pending.clear()
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, serializeChatHistory(history.chats, history.activeChatId))
    } catch {
      // A quota or security error must never prevent the conversation working.
    }
  }, [history])

  const commitHistory = useCallback((next: ChatHistory) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const setDraft = useCallback((text: string) => {
    const id = historyRef.current.activeChatId
    const next = { ...draftsRef.current, [id]: text }
    draftsRef.current = next
    setDrafts(next)
  }, [])

  const startChat = useCallback(async () => {
    let id = newId()
    if (transport.create) {
      try {
        id = (await transport.create(new AbortController().signal)).id
      } catch {
        // First send will create the backend dialog if this eager create fails.
      }
    }
    const chat = createChat(id, new Date().toISOString())
    commitHistory({
      ...historyRef.current,
      chats: [chat, ...historyRef.current.chats],
      activeChatId: chat.id,
    })
    return chat
  }, [commitHistory, transport])

  const syncList = useCallback(
    (items: readonly SchemaDialogListItem[]) => {
      const next = mergeRemoteList(historyRef.current, items)
      if (next !== historyRef.current) commitHistory(next)
    },
    [commitHistory],
  )

  const syncDialog = useCallback(
    (view: SchemaDialogView) => {
      if (operations.current.has(view.id)) return
      const next = mergeRemoteDialog(historyRef.current, view)
      if (next !== historyRef.current) commitHistory(next)
    },
    [commitHistory],
  )

  const selectChat = useCallback(
    (id: string) => {
      if (historyRef.current.chats.some((chat) => chat.id === id)) {
        commitHistory({ ...historyRef.current, activeChatId: id })
      }
    },
    [commitHistory],
  )

  const submit = useCallback(
    async (chatId: string, content: string, clarificationId?: string): Promise<boolean> => {
      // This synchronous ref lock catches same-tick double clicks before React renders.
      if (operations.current.has(chatId)) return false
      const chat = historyRef.current.chats.find((item) => item.id === chatId)
      if (!chat || chat.status !== 'open' || !content.trim()) return false
      const controller = new AbortController()
      operations.current.set(chatId, controller)
      setBusyChats((current) => ({ ...current, [chatId]: true }))
      setErrors((current) => ({ ...current, [chatId]: null }))
      const originalDraft = draftsRef.current[chatId] ?? ''
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
        ...(clarificationId ? { clarificationId } : {}),
      }
      let remoteId = chatId
      try {
        const reply = await transport.send([...chat.messages, userMessage], controller.signal, chatId)
        if (!mounted.current || controller.signal.aborted) return false
        if (!isChatReply(reply)) throw new Error('Invalid chat reply')
        remoteId = reply.dialogId && reply.dialogId !== chatId ? reply.dialogId : chatId
        if (remoteId !== chatId) operations.current.set(remoteId, controller)
        // Resolve against the latest history, not the active chat or a stale snapshot.
        const latest = historyRef.current
        commitHistory({
          ...latest,
          activeChatId: latest.activeChatId === chatId ? remoteId : latest.activeChatId,
          chats: latest.chats.map((item) => (item.id === chatId ? applyExchange({ ...item, id: remoteId }, userMessage, reply) : item)),
        })
        if (remoteId !== chatId) {
          const nextDrafts = { ...draftsRef.current }
          if (chatId in nextDrafts) {
            nextDrafts[remoteId] = nextDrafts[chatId] ?? ''
            delete nextDrafts[chatId]
            draftsRef.current = nextDrafts
            setDrafts(nextDrafts)
          }
        }
        // Never erase text typed during the request, or another chat's composer.
        if (!clarificationId && originalDraft.trim() === content.trim() && (draftsRef.current[remoteId] ?? draftsRef.current[chatId] ?? '') === originalDraft) {
          const nextDrafts = { ...draftsRef.current, [remoteId]: '' }
          delete nextDrafts[chatId]
          draftsRef.current = nextDrafts
          setDrafts(nextDrafts)
        }
        return true
      } catch {
        if (mounted.current && !controller.signal.aborted) {
          setErrors((current) => ({
            ...current,
            [chatId]: 'Не удалось получить ответ. Ваш ввод сохранён — попробуйте ещё раз.',
          }))
        }
        return false
      } finally {
        if (operations.current.get(chatId) === controller || operations.current.get(remoteId) === controller) {
          operations.current.delete(chatId)
          operations.current.delete(remoteId)
          if (mounted.current) setBusyChats((current) => ({ ...current, [chatId]: false, [remoteId]: false }))
        }
      }
    },
    [commitHistory, transport],
  )

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const current = historyRef.current
      const chat = current.chats.find((item) => item.id === current.activeChatId)
      if (!chat || chat.status !== 'open' || operations.current.has(chat.id)) return false
      if (pendingClarification(chat)) {
        setErrors((errors) => ({ ...errors, [chat.id]: 'Сначала ответьте на уточняющий вопрос.' }))
        return false
      }
      return submit(chat.id, text)
    },
    [submit],
  )

  const answer = useCallback(
    async (request: ClarificationRequest, value: ClarificationAnswer): Promise<boolean> => {
      const current = historyRef.current
      const chat = current.chats.find((item) => item.id === current.activeChatId)
      if (!chat || chat.status !== 'open' || operations.current.has(chat.id)) return false
      const pending = pendingClarification(chat)
      if (!pending || pending.id !== request.id) return false
      // Use the canonical request from history instead of caller-provided labels/options.
      const content = formatClarificationAnswer(pending, value)
      if (!content) {
        setErrors((errors) => ({ ...errors, [chat.id]: 'Выберите вариант ответа или заполните «Другое».' }))
        return false
      }
      return submit(chat.id, content, pending.id)
    },
    [submit],
  )

  // Ref-backed synchronous updates make lifecycle actions same-tick idempotent.
  const updateActiveChat = useCallback((update: (chat: Chat) => Chat): boolean => {
    const current = historyRef.current
    const chat = current.chats.find((item) => item.id === current.activeChatId)
    if (!chat || operations.current.has(chat.id)) return false
    const next = update(chat)
    if (next === chat) return false
    commitHistory({ ...current, chats: current.chats.map((item) => item.id === chat.id ? next : item) })
    setErrors((errors) => ({ ...errors, [chat.id]: null }))
    return true
  }, [commitHistory])

  const closeChat = useCallback((): void => {
    updateActiveChat((chat) => closeChatModel(chat, newId(), new Date().toISOString()))
  }, [updateActiveChat])

  const reopenChat = useCallback((): void => {
    updateActiveChat((chat) => reopenChatModel(chat, newId(), new Date().toISOString()))
  }, [updateActiveChat])

  const submitFeedback = useCallback((rating: FeedbackRating, comment: string): boolean => {
    // This is a local history update, not an API request.
    return updateActiveChat((chat) => submitFeedbackModel(chat, rating, comment, new Date().toISOString()))
  }, [updateActiveChat])

  const dismissFeedback = useCallback((): void => {
    updateActiveChat(dismissFeedbackModel)
  }, [updateActiveChat])

  const contactSpecialist = useCallback(async (): Promise<boolean> => {
    const current = historyRef.current
    const chat = current.chats.find((item) => item.id === current.activeChatId)
    if (!chat || operations.current.has(chat.id) || !canContactSpecialist(chat)) return false
    if (!transport.requestSpecialist) {
      setErrors((errors) => ({ ...errors, [chat.id]: 'Связь со специалистом недоступна: сервис не подключён.' }))
      return false
    }
    const controller = new AbortController()
    operations.current.set(chat.id, controller)
    setBusyChats((busy) => ({ ...busy, [chat.id]: true }))
    setErrors((errors) => ({ ...errors, [chat.id]: null }))
    try {
      const response = await transport.requestSpecialist(chat, controller.signal)
      if (!mounted.current || controller.signal.aborted) return false
      if (!isSpecialistResponse(response)) throw new Error('Invalid specialist response')
      const latest = historyRef.current
      const target = latest.chats.find((item) => item.id === chat.id)
      if (!target) return false
      const next = applySpecialistHandoff(target, response, newId(), new Date().toISOString())
      if (next === target) return false
      commitHistory({ ...latest, chats: latest.chats.map((item) => item.id === chat.id ? next : item) })
      return true
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        setErrors((errors) => ({ ...errors, [chat.id]: 'Не удалось связаться со специалистом. Попробуйте ещё раз.' }))
      }
      return false
    } finally {
      if (operations.current.get(chat.id) === controller) {
        operations.current.delete(chat.id)
        if (mounted.current) setBusyChats((busy) => ({ ...busy, [chat.id]: false }))
      }
    }
  }, [commitHistory, transport])

  const activeChat = history.chats.find((chat) => chat.id === history.activeChatId) ?? history.chats[0]
  return {
    chats: history.chats,
    activeChat,
    activeChatId: activeChat.id,
    drafts,
    draft: drafts[activeChat.id] ?? '',
    setDraft,
    createChat: startChat,
    selectChat,
    syncList,
    syncDialog,
    send,
    answer,
    closeChat,
    reopenChat,
    contactSpecialist,
    submitFeedback,
    dismissFeedback,
    canFeedback: canFeedback(activeChat),
    canContactSpecialist: canContactSpecialist(activeChat),
    busy: busyChats[activeChat.id] ?? false,
    error: errors[activeChat.id] ?? null,
    clarificationCount: clarificationCount(activeChat),
    pendingClarification: pendingClarification(activeChat),
  }
}
