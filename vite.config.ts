import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 5175,
        host: 'localhost',
        proxy: {
          '/api': {
            target: 'http://localhost:5176',
            changeOrigin: true,
            ws: true,
          },
        },
      },
      plugins: [react()],
      define: {
        // 本地允许不配置 key 也能启动页面；真正调用相关能力时再提示用户配置。
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
