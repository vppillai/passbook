/**
 * Platform detection utilities for React Native cross-platform support
 */
import { Platform } from 'react-native';

export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';
export const isWeb = Platform.OS === 'web';
export const isMobile = isIOS || isAndroid;

/**
 * Get platform-specific value
 * @param ios - Value for iOS
 * @param android - Value for Android
 * @param web - Value for Web
 * @returns Platform-specific value
 */
export function getPlatformValue<T>(ios: T, android: T, web: T): T {
  if (isIOS) return ios;
  if (isAndroid) return android;
  return web;
}

/**
 * Execute platform-specific code
 * @param ios - Function for iOS
 * @param android - Function for Android
 * @param web - Function for Web
 * @returns Result from platform-specific function
 */
export function platformSelect<T>(
  ios: () => T,
  android: () => T,
  web: () => T
): T {
  if (isIOS) return ios();
  if (isAndroid) return android();
  return web();
}

/**
 * Check if running in development mode
 */
export const isDevelopment = __DEV__;

/**
 * Get API base URL from environment
 */
export const getApiBaseUrl = (): string => {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/v1';
  return baseUrl;
};

/**
 * Get API key from environment
 */
export const getApiKey = (): string | undefined => {
  return process.env.EXPO_PUBLIC_API_KEY;
};
