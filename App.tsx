import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppNavigator } from './src/navigation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OfflineIndicator } from './src/components/common';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { syncService } from './src/services/syncService';
import { offlineQueue } from './src/services/offlineQueue';

export default function App() {
  useEffect(() => {
    // Initialize offline queue
    offlineQueue.loadQueue();

    // Start auto-sync when online
    syncService.startAutoSync();

    // Sync on app start if online
    syncService.sync();
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <OfflineIndicator />
          <AppNavigator />
          <StatusBar style="auto" />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
