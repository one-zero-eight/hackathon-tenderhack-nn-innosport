import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useId, useRef, useState, type FormEvent } from 'react'
import { LuHeadset, LuLoaderCircle, LuX } from 'react-icons/lu'
import type { SchemaSpecialistContact } from '@/api/types'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/input'

export default function SpecialistContact({ busy, onContact }: {
  busy: boolean
  onContact: (contact: SchemaSpecialistContact) => Promise<boolean>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [contact, setContact] = useState({ inn: '', organization_name: '', contact_email: '' })
  const [submitError, setSubmitError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const close = () => {
    if (!submittingRef.current) setOpen(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(false)
    try {
      const sent = await onContact({
        inn: contact.inn.trim(),
        organization_name: contact.organization_name.trim(),
        contact_email: contact.contact_email.trim(),
      })
      if (sent) setOpen(false)
      else setSubmitError(true)
    } catch {
      setSubmitError(true)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="mb-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-foreground/55 hover:text-foreground flex items-center gap-1.5 text-xs font-normal"
          aria-haspopup="dialog"
          onClick={() => {
            setSubmitError(false)
            setOpen(true)
          }}
        >
          <LuHeadset aria-hidden="true" className="size-3.5" />
          Передать оператору
        </Button>
      </div>
      <Dialog open={open} onClose={close} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
          <div className="flex min-h-full items-center justify-center">
            <DialogPanel className="bg-background text-foreground w-full max-w-md rounded-2xl p-5 shadow-xl sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="text-ui-title font-semibold">Передать вопрос оператору</DialogTitle>
                <Button variant="ghost" className="-mt-1 -mr-1 p-1.5" aria-label="Закрыть диалог" disabled={submitting} onClick={close}>
                  <LuX aria-hidden="true" className="size-5" />
                </Button>
              </div>
              <Description className="text-foreground/60 text-ui-body mt-2">
                Укажите реквизиты организации и email для связи. Оператор получит историю этого обращения.
              </Description>
              {busy && !submitting && (
                <p className="text-foreground/65 text-ui-body mt-3">Дождитесь ответа бота — после этого можно передать обращение.</p>
              )}
              <form onSubmit={(event) => void submit(event)}>
                <fieldset disabled={submitting} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor={`${id}-inn`} className="text-ui-body mb-1.5 block font-medium">ИНН организации</label>
                    <Input id={`${id}-inn`} name="inn" inputMode="numeric" pattern="[0-9]{10}|[0-9]{12}" minLength={10} maxLength={12} required value={contact.inn} onChange={(event) => setContact({ ...contact, inn: event.target.value })} aria-describedby={`${id}-inn-hint`} />
                    <p id={`${id}-inn-hint`} className="text-foreground/50 mt-1 text-xs">10 цифр для организации или 12 для ИП</p>
                  </div>
                  <div>
                    <label htmlFor={`${id}-organization`} className="text-ui-body mb-1.5 block font-medium">Наименование организации</label>
                    <Input id={`${id}-organization`} name="organization_name" autoComplete="organization" maxLength={300} pattern=".*\S.*" required value={contact.organization_name} onChange={(event) => setContact({ ...contact, organization_name: event.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={`${id}-email`} className="text-ui-body mb-1.5 block font-medium">Контактный email</label>
                    <Input id={`${id}-email`} name="contact_email" type="email" autoComplete="email" maxLength={254} required value={contact.contact_email} onChange={(event) => setContact({ ...contact, contact_email: event.target.value })} />
                  </div>
                </fieldset>
                {submitError && <p role="alert" className="text-error text-ui-body mt-4">Не удалось передать обращение. Реквизиты сохранены в форме — попробуйте ещё раз.</p>}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" disabled={submitting} onClick={close}>Отмена</Button>
                  <Button type="submit" disabled={busy || submitting} className="flex items-center justify-center gap-2">
                    {submitting && <LuLoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
                    {submitting ? 'Передаём…' : 'Передать оператору'}
                  </Button>
                </div>
              </form>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </>
  )
}
