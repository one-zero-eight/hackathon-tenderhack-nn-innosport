import AdminPage from '@/components/admin/AdminPage'
import ChatPage from '@/components/chat/ChatPage'

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  if (pathname === '/admin') return <AdminPage />
  return <ChatPage />
}
