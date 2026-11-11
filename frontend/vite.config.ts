import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// 2 つのエントリー: index.html(差分ビューア)と admin.html(管理者だけの画面)。別のバンドルにして、
// メイン画面のコードに基準画像の更新・撮影画像の削除を入れない。
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
})
