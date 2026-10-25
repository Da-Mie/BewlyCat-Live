import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

import { thirdPartyLicensesVitePlugin } from './scripts/thirdPartyLicenses'
import { isDev, isFirefox, isSafari, r } from './scripts/utils'
import unoConfig from './unocss.config'
import { sharedConfig } from './vite.config'

export default defineConfig({
  ...sharedConfig,
  root: r('src/live'),
  base: './',
  plugins: [UnoCSS({
    ...unoConfig,
    configFile: false,
    // Limit extraction to the live page's imported modules.
    content: { filesystem: [] },
    safelist: ['i-line-md:sunny-outline-to-moon-transition', 'i-line-md:moon-to-sunny-outline-transition'],
  }), ...sharedConfig.plugins!, thirdPartyLicensesVitePlugin('live')],
  build: {
    outDir: r(isFirefox ? 'extension-firefox/dist/live' : isSafari ? 'extension-safari/dist/live' : 'extension/dist/live'),
    emptyOutDir: !isDev,
    watch: isDev ? { include: ['./**/*'] } : undefined,
    rollupOptions: {
      input: r('src/live/index.html'),
      output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
})
