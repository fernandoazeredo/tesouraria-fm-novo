import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bibliotecas grandes em arquivos próprios: o navegador as mantém em cache
// entre publicações e o arquivo principal do app fica menor.
const vendorChunks: Record<string, string[]> = {
  'vendor-firebase': ['firebase', '@firebase'],
  'vendor-react': ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'],
  'vendor-icons': ['lucide-react'],
}

function chunkFor(id: string) {
  if (!id.includes('node_modules')) return undefined
  const path = id.split('node_modules/').pop() ?? ''
  for (const [chunk, packages] of Object.entries(vendorChunks)) {
    if (packages.some((name) => path === name || path.startsWith(`${name}/`))) return chunk
  }
  return undefined
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: chunkFor,
      },
    },
  },
})
