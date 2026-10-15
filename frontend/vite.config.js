import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const target=process.env.API_PROXY_TARGET || 'http://localhost:3000';
export default defineConfig({ plugins: [react()], server: { strictPort:true,proxy: { '/api': target, '/health': target, '/ready': target } } });

