import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/api'
import type { SchemaDialogResponse, SchemaDialogView } from '@/api/types'
import { isBackendDialogId, isDialogNotFound, isDialogPayload, mapDialogResponse, mapSpecialistResponse } from './dialog-map.ts'
import type { ChatTransport } from './types.ts'

export { isBackendDialogId, isDialogNotFound, isDialogPayload, mapDialogResponse, mapSpecialistResponse } from './dialog-map.ts'

type CreateDialog = (init: { signal?: AbortSignal }) => Promise<SchemaDialogView>
type PostMessage = (init: { params: { path: { dialog_id: string } }; body: { content: string }; signal?: AbortSignal }) => Promise<SchemaDialogResponse>

async function ensureDialogId(createDialog: CreateDialog, signal: AbortSignal, chatId?: string): Promise<string> {
  if (chatId && isBackendDialogId(chatId)) return chatId
  const created = await createDialog({ signal })
  return created.id
}

async function postDialogMessage(postMessage: PostMessage, createDialog: CreateDialog, content: string, signal: AbortSignal, chatId?: string): Promise<SchemaDialogResponse> {
  const dialogId = await ensureDialogId(createDialog, signal, chatId)
  try {
    return await postMessage({ params: { path: { dialog_id: dialogId } }, body: { content }, signal })
  } catch (error) {
    if (isDialogPayload(error)) return error
    if (!isDialogNotFound(error)) throw error
    const created = await createDialog({ signal })
    try {
      return await postMessage({ params: { path: { dialog_id: created.id } }, body: { content }, signal })
    } catch (retryError) {
      if (isDialogPayload(retryError)) return retryError
      throw retryError
    }
  }
}

export function useApiTransport(): ChatTransport {
  const queryClient = useQueryClient()
  const { mutateAsync: createDialog } = $api.useMutation('post', '/dialogs')
  const { mutateAsync: postMessage } = $api.useMutation('post', '/dialogs/{dialog_id}/messages')
  const { mutateAsync: escalate } = $api.useMutation('post', '/dialogs/{dialog_id}/escalate')
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
        send: async (messages, signal, chatId) => {
          const content = messages.at(-1)?.content.trim() ?? ''
          if (!content) throw new Error('Empty message')
          const reply = mapDialogResponse(await postDialogMessage(postMessage, createDialog, content, signal, chatId))
          invalidateDialogs()
          return reply
        },
        requestSpecialist: async (chat, signal) => {
          try {
            const response = mapSpecialistResponse(await escalate({ params: { path: { dialog_id: chat.id } }, signal }))
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
    [createDialog, deleteDialog, deleteDialogs, escalate, postMessage, queryClient],
  )
}
