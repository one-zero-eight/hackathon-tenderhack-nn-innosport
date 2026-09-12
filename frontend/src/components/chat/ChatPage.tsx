import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useMatch, useNavigate, useRouter } from '@tanstack/react-router'
import { LuArrowDown, LuPanelLeft } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { $api } from '@/api'
import { isBackendDialogId, useApiTransport } from '@/features/chat/api-transport'
import { useChat } from '@/features/chat/useChat'
import { isDialogNotFound } from '@/features/chat/dialog-map'
import ChatSidebar from './ChatSidebar'
import ChatComposer from './ChatComposer'
import SpecialistContact from './SpecialistContact'
import BotFeedbackCard from './BotFeedbackCard'
import ChatStatusActions from './ChatStatusActions'
import ChatTranscript, { type ChatTranscriptHandle } from './ChatTranscript'

export default function ChatPage() {
  const dialogId = useMatch({ from: '/_chat/tickets/$dialogId', shouldThrow: false, select: (match) => match.params.dialogId })
  const navigate = useNavigate()
  const router = useRouter()
  const onActiveChatChange = useCallback(
    (id: string, previousId: string) => {
      if (router.state.location.pathname === `/tickets/${previousId}`) {
        void navigate({ to: '/tickets/$dialogId', params: { dialogId: id }, replace: true })
      }
    },
    [navigate, router],
  )
  const transport = useApiTransport()
  const chat = useChat(transport, onActiveChatChange)
  const { data: listed, isLoading: listLoading, isError: listError } = $api.useQuery('get', '/dialogs', { params: { query: { limit: 100 } } })
  const requestedId = dialogId ?? chat.activeChatId
  const dialogQuery = $api.useQuery('get', '/dialogs/{dialog_id}', { params: { path: { dialog_id: requestedId } } }, { enabled: isBackendDialogId(requestedId) })
  const dialog = dialogQuery.data
  const [leftOpen, setLeftOpen] = useState(false)
  const [nearBottom, setNearBottom] = useState(true)
  const transcriptRef = useRef<ChatTranscriptHandle>(null)
  const messages = chat.activeChat.messages
  const closed = chat.activeChat.status === 'closed'

  const { syncList, syncDialog, selectChat, chats } = chat

  useEffect(() => {
    if (listed) syncList(listed)
  }, [listed, syncList])

  useEffect(() => {
    if (dialog) syncDialog(dialog)
  }, [dialog, syncDialog])

  useEffect(() => {
    if (dialogId) selectChat(dialogId)
  }, [dialogId, chats, selectChat])

  useEffect(() => {
    if (!dialogId) void navigate({ to: '/tickets/$dialogId', params: { dialogId: chat.activeChatId }, replace: true })
  }, [dialogId, chat.activeChatId, navigate])

  const routeReady = dialogId === chat.activeChatId
  const missingLocalChat = Boolean(dialogId && !isBackendDialogId(dialogId) && !chat.chats.some((item) => item.id === dialogId))
  const routeError = missingLocalChat || dialogQuery.isError
  const notFound = missingLocalChat || isDialogNotFound(dialogQuery.error)

  const createTicket = async () => {
    const created = await chat.createChat()
    await navigate({ to: '/tickets/$dialogId', params: { dialogId: created.id } })
    setLeftOpen(false)
  }

  const sidebar = (
    <ChatSidebar
      chats={chat.chats}
      activeId={dialogId ?? chat.activeChatId}
      loading={listLoading}
      error={listError ? 'Не удалось загрузить обращения с сервера.' : null}
      onSelect={() => setLeftOpen(false)}
      onCreate={() => void createTicket()}
      busy={chat.mutating}
      onDelete={(id) => {
        void chat.deleteChat(id)
      }}
      onDeleteAll={() => {
        void chat.deleteAllChats()
      }}
    />
  )
  return (
    <div className="bg-background text-foreground flex h-dvh overflow-hidden">
      <aside className="border-border hidden w-64 shrink-0 border-r md:block">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <main className="relative flex min-w-0 flex-1 flex-col">
            <Button variant="ghost" className="bg-background/90 absolute top-4 left-4 z-20 p-2 shadow-sm backdrop-blur md:hidden" aria-label="Открыть список обращений" onClick={() => setLeftOpen(true)}>
              <LuPanelLeft className="size-5" />
            </Button>
            {routeError ? (
              <div role="alert" className="m-auto space-y-3 p-6 text-center">
                <p>{notFound ? 'Обращение не найдено.' : 'Не удалось загрузить обращение.'}</p>
                {!notFound && (
                  <Button variant="outline" disabled={dialogQuery.isFetching} onClick={() => void dialogQuery.refetch()}>
                    Повторить
                  </Button>
                )}
                <Button variant="outline" onClick={() => void createTicket()}>
                  Новое обращение
                </Button>
              </div>
            ) : !routeReady || (isBackendDialogId(requestedId) && dialogQuery.isPending) ? (
              <p role="status" className="text-foreground/50 m-auto p-6">
                Загружаем обращение…
              </p>
            ) : (
              <>
                <ChatTranscript
                  ref={transcriptRef}
                  chat={chat.activeChat}
                  busy={chat.busy}
                  onAnswerClarification={chat.answerClarification}
                  onNearBottomChange={setNearBottom}
                  afterMessages={
                    chat.canFeedback || chat.activeChat.feedback ? (
                      <BotFeedbackCard
                        key={chat.activeChatId}
                        feedback={chat.activeChat.feedback}
                        waitingForSpecialist={!!chat.activeChat.handoff && !closed}
                        busy={chat.busy}
                        onSubmit={chat.submitFeedback}
                        onDismiss={chat.dismissFeedback}
                      />
                    ) : undefined
                  }
                />
                <div className="bg-background shrink-0 px-4 pt-2 pb-4 sm:px-8">
                  <div className="mx-auto max-w-3xl">
                    {chat.error && (
                      <p role="alert" className="border-error/20 bg-error/5 text-error text-ui-body mb-3 rounded-xl border p-3">
                        {chat.error}
                      </p>
                    )}
                    {chat.activeChat.handoff && (
                      <p role="status" className="text-primary text-ui-body mb-3 text-center">
                        {closed
                          ? chat.activeChat.handoff.simulated
                            ? 'Демонстрационная передача специалисту сохранена'
                            : 'Обращение было передано специалисту'
                          : chat.activeChat.handoff.simulated
                            ? 'Деморежим: ожидаем специалиста'
                            : 'Ожидаем специалиста'}
                      </p>
                    )}
                    <ChatStatusActions
                      closed={closed}
                      busy={chat.busy}
                      latestAction={
                        !nearBottom && messages.length > 0 ? (
                          <Button variant="outline" size="sm" aria-label="К последнему сообщению" onClick={() => transcriptRef.current?.scrollToBottom()} className="bg-background flex items-center gap-2 rounded-full">
                            <LuArrowDown className="size-3" />
                            <span className="hidden sm:inline">К последнему сообщению</span>
                          </Button>
                        ) : undefined
                      }
                      onClose={chat.closeChat}
                      onReopen={chat.reopenChat}
                    />
                    {chat.canContactSpecialist && <SpecialistContact key={chat.activeChatId} busy={chat.busy} onPreview={chat.previewSpecialist} onContact={chat.contactSpecialist} />}
                    {!closed && <ChatComposer draft={chat.draft} onDraft={chat.setDraft} onSend={chat.send} busy={chat.busy} />}
                  </div>
                </div>
              </>
            )}
            <Outlet />
          </main>
        </div>
      </div>
      <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} title="Ваши обращения">
        {sidebar}
      </Drawer>
    </div>
  )
}
