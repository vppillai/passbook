/**
 * Screen for managing parents in the family
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
import { RootStackParamList, ParentAccount } from '../../types';
import { Button, LoadingSpinner } from '../../components/common';
import { InviteParentModal } from '../../components/dashboard/InviteParentModal';
import { parentAccountsService } from '../../services/parentAccounts';

type ParentManagementScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'ParentDashboard'
>;

export const ParentManagementScreen: React.FC = () => {
  const navigation = useNavigation<ParentManagementScreenNavigationProp>();
  const [parents, setParents] = useState<ParentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadParents();
  }, []);

  const loadParents = async () => {
    setLoading(true);
    try {
      const parentsList = await parentAccountsService.listParents();
      setParents(parentsList);
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to load parents'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadParents();
    setRefreshing(false);
  };

  const handleResendInvitation = async (email: string) => {
    try {
      await parentAccountsService.resendInvitation(email);
      Alert.alert('Success', 'Invitation resent successfully');
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to resend invitation'
      );
    }
  };

  if (loading && parents.length === 0) {
    return <LoadingSpinner message="Loading parents..." />;
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
          <Text style={styles.title}>Family Parents</Text>
          <Text style={styles.subtitle}>
            Manage parents with account manager rights
          </Text>
        </View>

        {parents.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No parents added yet</Text>
            <Text style={styles.emptySubtext}>
              Invite another parent to share account management
            </Text>
          </View>
        ) : (
          <View style={styles.parentsList}>
            {parents.map((parent) => (
              <View key={parent.userId} style={styles.parentCard}>
                <View style={styles.parentInfo}>
                  <Text style={styles.parentName}>{parent.displayName}</Text>
                  <Text style={styles.parentEmail}>{parent.email}</Text>
                  {parent.status === 'pending' && (
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>Pending Invitation</Text>
                    </View>
                  )}
                  {parent.status === 'active' && (
                    <Text style={styles.statusText}>Active</Text>
                  )}
                </View>
                {parent.status === 'pending' && (
                  <Button
                    title="Resend"
                    onPress={() => handleResendInvitation(parent.email)}
                    variant="outline"
                    style={styles.resendButton}
                  />
                )}
              </View>
            ))}
          </View>
        )}

        <Button
          title="Invite Parent"
          onPress={() => setModalVisible(true)}
          style={styles.inviteButton}
        />
      </ScrollView>

      <InviteParentModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={loadParents}
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
  parentsList: {
    marginBottom: 20,
  },
  parentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  parentInfo: {
    flex: 1,
  },
  parentName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  parentEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF3CD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 4,
  },
  statusText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '500',
  },
  resendButton: {
    marginLeft: 12,
  },
  inviteButton: {
    marginTop: 20,
  },
});
