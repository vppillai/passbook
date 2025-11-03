/**
 * Version utility to get the application version
 */

// Get version from build-time constant (same as AppVersion component)
// This is statically replaced by Vite during build from git version
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/**
 * Get the formatted version string for display
 */
export const getVersionDisplay = (): string => {
  return `v${APP_VERSION}`;
};

/**
 * Get the full version information
 */
export const getVersionInfo = () => {
  return {
    version: APP_VERSION,
    displayVersion: getVersionDisplay(),
  };
};