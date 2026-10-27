import type { Language } from '@/core/api'
import { cn } from '@/ui/lib/utils'
import { voiceChip, type Voice } from '@/ui/voice'

export function LanguageChip({ language, voice }: { language: Language; voice: Voice }) {
  return (
    <span
      lang={language.code}
      className={cn('speech inline-flex h-9 items-center rounded-full px-3.5 text-base leading-none', voiceChip[voice])}
    >
      {language.nativeName}
    </span>
  )
}
