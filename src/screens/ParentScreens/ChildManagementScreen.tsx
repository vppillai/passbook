/**
 * Child management screen for parents to view and manage child accounts
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types';
import { Button, LoadingSpinner } from '../../components/common';
import { AddChildModal } from '../../components/dashboard/AddChildModal';
import { ChildAccountCard } from '../../components/dashboard/ChildAccountCard';
import { childAccountsService } from '../../services/childAccounts';
import { useChildrenStore } from '../../store';

type ChildManagementScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'ParentDashboard'
>;

export const ChildManagementScreen: React.FC = () => {
  const navigation = useNavigation<ChildManagementScreenNavigationProp>();
  const { children, setChildren, setLoading, setError } = useChildrenStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadChildren = async () => {
    setLoading(true);
    setError(null);
    try {
      const childrenList = await childAccountsService.listChildren();
      setChildren(childrenList);
    } catch (error: any) {
      setError(error.message || 'Failed to load children');
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to load children'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChildren();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadChildren();
    setRefreshing(false);
  };

  const handleChildPress = (child: any) => {
    // Navigate to child details or expense list
    // TODO: Implement child detail screen
    console.log('Child pressed:', child.userId);
  };

  const handleEditChild = (child: any) => {
    // TODO: Implement edit child modal
    Alert.alert('Edit Child', `Edit functionality for ${child.displayName}`);
  };

  const handleDeleteChild = (child: any) => {
    Alert.alert(
      'Delete Child',
      `Are you sure you want to delete ${child.displayName}'s account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // TODO: Implement delete child
            Alert.alert('Not Implemented', 'Delete functionality coming soon');
          },
        },
      ]
    );
  };

  if (useChildrenStore.getState().loading && children.length === 0) {
    return <LoadingSpinner message="Loading children..." />;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Child Accounts</Text>
          <Text style={styles.subtitle}>
            Manage your children's accounts and allowances
          </Text>
        </View>

        {children.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No children added yet</Text>
            <Text style={styles.emptySubtext}>
              Add your first child account to get started
            </Text>
          </View>
        ) : (
          <View style={styles.childrenList}>
            {children.map((child) => (
              <ChildAccountCard
                key={child.userId}
                child={child}
                onPress={() => handleChildPress(child)}
                onEdit={() => handleEditChild(child)}
              />
            ))}
          </View>
        )}

        <Button
          title="Add Child Account"
          onPress={() => setModalVisible(true)}
          style={styles.addButton}
        />
      </ScrollView>

      <AddChildModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={loadChildren}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  childrenList: {
    marginBottom: 20,
  },
  addButton: {
    marginTop: 20,
  },
});
