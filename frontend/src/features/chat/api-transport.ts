import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api, eventsFetch } from '@/api'
import { readDialogStream } from './stream.ts'
import type { SchemaDialogResponse, SchemaDialogView, SchemaMessageCreate } from '@/api/types'
import { isBackendDialogId, isDialogNotFound, isDialogPayload, mapDialogFeedback, mapDialogResponse, mapSpecialistResponse } from './dialog-map.ts'
import type { ChatToolCall, ChatTransport } from './types.ts'

export { isBackendDialogId, isDialogNotFound, isDialogPayload, mapDialogResponse, mapSpecialistResponse } from './dialog-map.ts'

type CreateDialog = (init: { signal?: AbortSignal }) => Promise<SchemaDialogView>
type PostMessage = (init: { params: { path: { dialog_id: string } }; body: SchemaMessageCreate; signal: AbortSignal }) => Promise<SchemaDialogResponse>

async function streamMessage(init: Parameters<PostMessage>[0], onText?: (text: string) => void, onTool?: (tool: ChatToolCall) => void): Promise<SchemaDialogResponse> {
  const { data, error, response } = await eventsFetch.POST('/dialogs/{dialog_id}/messages/stream', { ...init, parseAs: 'stream' })
  if (error) throw error
  if (!data || !response.ok) throw new Error('Dialog stream unavailable')
  return readDialogStream(data, init.signal, onText, onTool)
}

async function ensureDialogId(createDialog: CreateDialog, signal: AbortSignal, chatId?: string): Promise<string> {
  if (chatId && isBackendDialogId(chatId)) return chatId
  const created = await createDialog({ signal })
  return created.id
}

async function postDialogMessage(postMessage: PostMessage, createDialog: CreateDialog, body: SchemaMessageCreate, signal: AbortSignal, chatId?: string): Promise<SchemaDialogResponse> {
  const dialogId = await ensureDialogId(createDialog, signal, chatId)
  try {
    return await postMessage({ params: { path: { dialog_id: dialogId } }, body, signal })
  } catch (error) {
    if (isDialogPayload(error)) return error
    if (!isDialogNotFound(error) || body.clarification_id) throw error
    const created = await createDialog({ signal })
    try {
      return await postMessage({ params: { path: { dialog_id: created.id } }, body, signal })
    } catch (retryError) {
      if (isDialogPayload(retryError)) return retryError
      throw retryError
    }
  }
}

export function useApiTransport(): ChatTransport {
  const queryClient = useQueryClient()
  const { mutateAsync: createDialog } = $api.useMutation('post', '/dialogs')
  const { mutateAsync: escalate } = $api.useMutation('post', '/dialogs/{dialog_id}/escalate')
  const { mutateAsync: saveFeedback } = $api.useMutation('put', '/dialogs/{dialog_id}/feedback')
  const { mutateAsync: deleteDialog } = $api.useMutation('delete', '/dialogs/{dialog_id}')
  const { mutateAsync: deleteDialogs } = $api.useMutation('delete', '/dialogs')

  return useMemo<ChatTransport>(
    () => {
      const invalidateDialogs = () => {
        void queryClient.invalidateQueries({ queryKey: ['api', 'get', '/dialogs'] })
        void queryClient.invalidateQueries({ queryKey: ['api', 'get', '/dialogs/{dialog_id}'] })
      }
      return {
        create: async (signal) => {
          const created = await createDialog({ signal })
          invalidateDialogs()
          return { id: created.id }
        },
        send: async (messages, signal, chatId, onText, onTool) => {
          const message = messages.at(-1)
          const content = message?.content.trim() ?? ''
          if (!content) throw new Error('Empty message')
          const body: SchemaMessageCreate = { content, ...(message?.clarificationId ? { clarification_id: message.clarificationId } : {}) }
          const reply = mapDialogResponse(await postDialogMessage((init) => streamMessage(init, onText, onTool), createDialog, body, signal, chatId))
          invalidateDialogs()
          return reply
        },
        previewSpecialist: async (chatId, signal) => {
          const dialogId = await ensureDialogId(createDialog, signal, chatId)
          const options = $api.queryOptions('get', '/dialogs/{dialog_id}/escalation-preview', {
            params: { path: { dialog_id: dialogId } },
            signal,
          }, { staleTime: 0 })
          const data = await queryClient.fetchQuery(options)
          return { dialogId, line: data.line }
        },
        requestSpecialist: async (chat, signal, contact) => {
          try {
            const response = mapSpecialistResponse(await escalate({ params: { path: { dialog_id: chat.id } }, body: contact, signal }))
            invalidateDialogs()
            return response
          } catch (error) {
            if (isDialogPayload(error)) {
              invalidateDialogs()
              return mapSpecialistResponse(error)
            }
            throw error
          }
        },
        submitFeedback: async (chatId, rating, comment, signal) => {
          const feedback = await saveFeedback({ params: { path: { dialog_id: chatId } }, body: { rating, comment }, signal })
          invalidateDialogs()
          return mapDialogFeedback(feedback)
        },
        delete: async (chatId, signal) => {
          if (!isBackendDialogId(chatId)) return
          try {
            await deleteDialog({ params: { path: { dialog_id: chatId } }, signal })
          } catch (error) {
            if (!isDialogNotFound(error)) throw error
          }
          queryClient.setQueriesData({ queryKey: ['api', 'get', '/dialogs'] }, (current) => (Array.isArray(current) ? current.filter((item) => item && typeof item === 'object' && 'id' in item && item.id !== chatId) : current))
          invalidateDialogs()
        },
        deleteAll: async (signal) => {
          await deleteDialogs({ signal })
          queryClient.setQueriesData({ queryKey: ['api', 'get', '/dialogs'] }, () => [])
          invalidateDialogs()
        },
      }
    },
    [createDialog, deleteDialog, deleteDialogs, escalate, saveFeedback, queryClient],
  )
}
