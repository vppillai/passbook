/**
 * Floating Action Button component
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';

interface FABProps {
  onPress: () => void;
  icon?: string;
  style?: ViewStyle;
}

export const FAB: React.FC<FABProps> = ({ onPress, icon = '+', style }) => {
  return (
    <TouchableOpacity style={[styles.fab, style]} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.icon}>{icon}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  icon: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '300',
    lineHeight: 32,
  },
});
