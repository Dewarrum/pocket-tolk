import type { ReactNode } from 'react'

/**
 * The three bands of every screen: header, words, and the dock that holds
 * the controls in the thumb zone. The document scrolls normally so iOS can
 * bring a focused field into view above the keyboard.
 */
export function Screen({ header, children, dock }: { header?: ReactNode; children: ReactNode; dock?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))]">
      {header ? (
        <header className="sticky top-0 z-10 -mx-3 bg-paper px-3 pt-[env(safe-area-inset-top)]">{header}</header>
      ) : (
        <div className="pt-[env(safe-area-inset-top)]" />
      )}
      <main className="flex flex-1 flex-col pt-6 pb-8">{children}</main>
      {dock && (
        <div className="sticky bottom-0 z-10 -mx-3 bg-paper px-3 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {dock}
        </div>
      )}
    </div>
  )
}
