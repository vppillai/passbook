/**
 * Offline indicator component
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export const OfflineIndicator: React.FC = () => {
  const [isOffline, setIsOffline] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !state.isConnected;
      setIsOffline(offline);

      if (offline) {
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      } else {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }
    });

    return () => unsubscribe();
  }, [fadeAnim]);

  if (!isOffline) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Text style={styles.text}>Offline - Changes will sync when online</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FF9500',
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});
