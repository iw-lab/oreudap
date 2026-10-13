import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  server: { host: '127.0.0.1' },
  // 전수 테스트(오답 규칙·한 판 끝까지)는 호스트 부하(load 100+)에서 기본 5초를 넘긴다 — 실패가 아니라 시간 초과라 넉넉히
  test: { testTimeout: 60000 },
});
