import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#172554' } },
    // The SVG is already a full-bleed tile, so the home-screen icon needs no extra padding.
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: '#172554' } },
  },
  images: ['public/favicon.svg'],
})
