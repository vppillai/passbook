/**
 * Version utility to get the application version
 */

// Import the version from package.json during build time
// This will be statically replaced by Vite during build
export const APP_VERSION = '1.0.0';

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