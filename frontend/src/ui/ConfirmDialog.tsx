import type { ReactNode } from 'react'
import { Button } from '@/ui/primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog'

/** A yes/no question anchored above the home indicator, in the thumb zone. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancel,
  confirm,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  cancel: string
  confirm: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-auto bottom-[max(1.25rem,env(safe-area-inset-bottom))] translate-y-0 gap-5 p-5"
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">{title}</DialogTitle>
          <DialogDescription className="text-base">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="-mx-5 -mb-5 grid grid-cols-2 gap-3 border-t-0 bg-transparent p-5 pt-0">
          <DialogClose asChild>
            <Button variant="outline">{cancel}</Button>
          </DialogClose>
          <Button onClick={onConfirm}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
