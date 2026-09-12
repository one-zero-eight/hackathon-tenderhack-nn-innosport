import { useEffect, useRef, useState } from 'react'
import { LuArrowDown, LuPanelLeft } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { $api } from '@/api'
import { isBackendDialogId, useApiTransport } from '@/features/chat/api-transport'
import { useChat } from '@/features/chat/useChat'
import ChatSidebar from './ChatSidebar'
import ChatComposer from './ChatComposer'
import SpecialistContact from './SpecialistContact'
import BotFeedbackCard from './BotFeedbackCard'
import ChatStatusActions from './ChatStatusActions'
import ChatTranscript, { type ChatTranscriptHandle } from './ChatTranscript'

export default function ChatPage() {
  const transport = useApiTransport()
  const chat = useChat(transport)
  const { data: listed, isLoading: listLoading, isError: listError } = $api.useQuery('get', '/dialogs', { params: { query: { limit: 100 } } })
  const { data: dialog } = $api.useQuery(
    'get',
    '/dialogs/{dialog_id}',
    { params: { path: { dialog_id: chat.activeChatId } } },
    { enabled: isBackendDialogId(chat.activeChatId) },
  )
  const [leftOpen, setLeftOpen] = useState(false)
  const [nearBottom, setNearBottom] = useState(true)
  const transcriptRef = useRef<ChatTranscriptHandle>(null)
  const messages = chat.activeChat.messages
  const closed = chat.activeChat.status === 'closed'

  useEffect(() => {
    if (listed) chat.syncList(listed)
  }, [listed, chat.syncList])

  useEffect(() => {
    if (dialog) chat.syncDialog(dialog)
  }, [dialog, chat.syncDialog])

  const sidebar = (
    <ChatSidebar
      chats={chat.chats}
      activeId={chat.activeChatId}
      loading={listLoading}
      error={listError ? 'Не удалось загрузить обращения с сервера.' : null}
      onSelect={(id) => {
        chat.selectChat(id)
        setLeftOpen(false)
      }}
      onCreate={() => {
        void chat.createChat()
        setLeftOpen(false)
      }}
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
            <ChatTranscript
              ref={transcriptRef}
              chat={chat.activeChat}
              busy={chat.busy}
              onNearBottomChange={setNearBottom}
              afterMessages={
                (chat.canFeedback || chat.activeChat.feedback) ? (
                  <BotFeedbackCard key={chat.activeChatId} feedback={chat.activeChat.feedback} waitingForSpecialist={!!chat.activeChat.handoff && !closed} busy={chat.busy} onSubmit={chat.submitFeedback} onDismiss={chat.dismissFeedback} />
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
                    {closed ? (chat.activeChat.handoff.simulated ? 'Демонстрационная передача специалисту сохранена' : 'Обращение было передано специалисту') : chat.activeChat.handoff.simulated ? 'Деморежим: ожидаем специалиста' : 'Ожидаем специалиста'}
                  </p>
                )}
                <ChatStatusActions
                  closed={closed}
                  busy={chat.busy}
                  latestAction={
                    !nearBottom && messages.length > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="К последнему сообщению"
                        onClick={() => transcriptRef.current?.scrollToBottom()}
                        className="bg-background flex items-center gap-2 rounded-full"
                      >
                        <LuArrowDown className="size-3" />
                        <span className="hidden sm:inline">К последнему сообщению</span>
                      </Button>
                    ) : undefined
                  }
                  onClose={chat.closeChat}
                  onReopen={chat.reopenChat}
                />
                {!closed && !chat.activeChat.handoff && chat.canContactSpecialist && <SpecialistContact busy={chat.busy} onContact={chat.contactSpecialist} />}
                {!closed && <ChatComposer draft={chat.draft} onDraft={chat.setDraft} onSend={chat.send} busy={chat.busy} />}
              </div>
            </div>
          </main>
        </div>
      </div>
      <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} title="Ваши обращения">
        {sidebar}
      </Drawer>
    </div>
  )
}
