import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

// Get git version for tests
function getGitVersion() {
  try {
    const gitDescribe = execSync('git describe --always --abbrev=8', { encoding: 'utf-8' }).trim();
    return gitDescribe.replace('-dirty', '');
  } catch (error) {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(getGitVersion()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});

