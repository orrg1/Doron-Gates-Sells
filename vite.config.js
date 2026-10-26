import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: "/Doron-Gates-Sells/", // שם הריפו שלך בגיטהאב
  plugins: [react()],
  // Shown in the sidebar, so it is easy to see whether the browser runs the latest version.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
})
