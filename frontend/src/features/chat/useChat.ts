import { useCallback, useEffect, useRef, useState } from 'react'
import { demoTransport } from './demo-transport.ts'
import type { SchemaDialogListItem, SchemaDialogView } from '@/api/types'
import { mergeRemoteDialog, mergeRemoteList } from './dialog-map.ts'
import { applyExchange, applySpecialistHandoff, canContactSpecialist, canFeedback, CHAT_STORAGE_KEY, CHAT_STORAGE_VERSION, closeChat as closeChatModel, createChat, dismissFeedback as dismissFeedbackModel, isChatReply, isSpecialistResponse, parseChatHistory, reopenChat as reopenChatModel, serializeChatHistory, submitFeedback as submitFeedbackModel, withOnlyChat, withoutChat } from './model.ts'
import type { ChatHistory } from './model.ts'
import type { Chat, ChatMessage, ChatTransport, FeedbackRating } from './types.ts'

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
  deleteChat: (id: string) => Promise<boolean>
  deleteAllChats: () => Promise<boolean>
  syncList: (items: readonly SchemaDialogListItem[]) => void
  syncDialog: (view: SchemaDialogView) => void
  send: (text: string) => Promise<boolean>
  closeChat: () => void
  reopenChat: () => void
  contactSpecialist: () => Promise<boolean>
  submitFeedback: (rating: FeedbackRating, comment: string) => boolean
  dismissFeedback: () => void
  canFeedback: boolean
  canContactSpecialist: boolean
  busy: boolean
  mutating: boolean
  error: string | null
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

  const allocateChat = useCallback(async (): Promise<Chat> => {
    let id = newId()
    if (transport.create) {
      try {
        id = (await transport.create(new AbortController().signal)).id
      } catch {
        // First send will create the backend dialog if this eager create fails.
      }
    }
    return createChat(id, new Date().toISOString())
  }, [transport])

  const startChat = useCallback(async () => {
    const chat = await allocateChat()
    commitHistory({
      ...historyRef.current,
      chats: [chat, ...historyRef.current.chats],
      activeChatId: chat.id,
    })
    return chat
  }, [allocateChat, commitHistory])

  const syncList = useCallback(
    (items: readonly SchemaDialogListItem[]) => {
      const next = mergeRemoteList(historyRef.current, items)
      if (next.chats.length === 0) {
        commitHistory(withOnlyChat(createChat(newId(), new Date().toISOString())))
        return
      }
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
    async (chatId: string, content: string): Promise<boolean> => {
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
        if (originalDraft.trim() === content.trim() && (draftsRef.current[remoteId] ?? draftsRef.current[chatId] ?? '') === originalDraft) {
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
      return submit(chat.id, text)
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

  const deleteChat = useCallback(
    async (id: string): Promise<boolean> => {
      const current = historyRef.current
      if (!current.chats.some((chat) => chat.id === id)) return false
      operations.current.get(id)?.abort()
      operations.current.delete(id)
      setBusyChats((busy) => ({ ...busy, [id]: true }))
      setErrors((errors) => ({ ...errors, [id]: null }))
      try {
        if (transport.delete) await transport.delete(id, new AbortController().signal)
        if (!mounted.current) return false
        const leftover = historyRef.current.chats.filter((chat) => chat.id !== id)
        const replacement = leftover.length === 0 ? await allocateChat() : createChat(newId(), new Date().toISOString())
        if (!mounted.current) return false
        commitHistory(withoutChat(historyRef.current, id, replacement))
        const nextDrafts = { ...draftsRef.current }
        delete nextDrafts[id]
        draftsRef.current = nextDrafts
        setDrafts(nextDrafts)
        return true
      } catch {
        if (mounted.current) {
          setErrors((errors) => ({ ...errors, [id]: 'Не удалось удалить обращение. Попробуйте ещё раз.' }))
        }
        return false
      } finally {
        if (mounted.current) setBusyChats((busy) => ({ ...busy, [id]: false }))
      }
    },
    [allocateChat, commitHistory, transport],
  )

  const deleteAllChats = useCallback(async (): Promise<boolean> => {
    for (const controller of operations.current.values()) controller.abort()
    operations.current.clear()
    setBusyChats(Object.fromEntries(historyRef.current.chats.map((chat) => [chat.id, true])))
    try {
      if (transport.deleteAll) await transport.deleteAll(new AbortController().signal)
      if (!mounted.current) return false
      const replacement = await allocateChat()
      if (!mounted.current) return false
      commitHistory(withOnlyChat(replacement))
      draftsRef.current = {}
      setDrafts({})
      setErrors({})
      return true
    } catch {
      if (mounted.current) {
        setErrors((current) => ({ ...current, [historyRef.current.activeChatId]: 'Не удалось удалить обращения. Попробуйте ещё раз.' }))
      }
      return false
    } finally {
      if (mounted.current) setBusyChats({})
    }
  }, [allocateChat, commitHistory, transport])

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
    deleteChat,
    deleteAllChats,
    syncList,
    syncDialog,
    send,
    closeChat,
    reopenChat,
    contactSpecialist,
    submitFeedback,
    dismissFeedback,
    canFeedback: canFeedback(activeChat),
    canContactSpecialist: canContactSpecialist(activeChat),
    busy: busyChats[activeChat.id] ?? false,
    mutating: Object.values(busyChats).some(Boolean),
    error: errors[activeChat.id] ?? null,
  }
}
