/**
 * Modal component for exporting reports
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Button } from '../common';
import { analyticsService } from '../../services/analytics';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

interface ReportExportModalProps {
  visible: boolean;
  onClose: () => void;
  childUserId: string;
  startDate?: string;
  endDate?: string;
}

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  visible,
  onClose,
  childUserId,
  startDate,
  endDate,
}) => {
  const [loading, setLoading] = useState(false);
  const [exportType, setExportType] = useState<'pdf' | 'excel' | null>(null);

  const handleExport = async (type: 'pdf' | 'excel') => {
    setLoading(true);
    setExportType(type);

    try {
      const reportData = await analyticsService.generateReport(
        childUserId,
        type,
        { startDate, endDate }
      );

      // Generate file based on type
      if (type === 'pdf') {
        await generatePDF(reportData);
      } else {
        await generateExcel(reportData);
      }

      Alert.alert('Success', `${type.toUpperCase()} report generated successfully`);
      onClose();
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || `Failed to generate ${type} report`
      );
    } finally {
      setLoading(false);
      setExportType(null);
    }
  };

  const generatePDF = async (data: any) => {
    // TODO: Implement PDF generation using @react-pdf/renderer
    // For now, just show success message
    console.log('PDF generation not yet implemented', data);
    Alert.alert('Info', 'PDF generation will be implemented with @react-pdf/renderer');
  };

  const generateExcel = async (data: any) => {
    // TODO: Implement Excel generation using xlsx library
    // For now, just show success message
    console.log('Excel generation not yet implemented', data);
    Alert.alert('Info', 'Excel generation will be implemented with xlsx library');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.title}>Export Report</Text>
            <Text style={styles.subtitle}>
              Choose a format to export your financial report
            </Text>

            <View style={styles.buttonContainer}>
              <Button
                title="Export as PDF"
                onPress={() => handleExport('pdf')}
                loading={loading && exportType === 'pdf'}
                style={styles.button}
              />
              <Button
                title="Export as Excel"
                onPress={() => handleExport('excel')}
                loading={loading && exportType === 'excel'}
                variant="outline"
                style={styles.button}
              />
              <Button
                title="Cancel"
                onPress={onClose}
                variant="outline"
                style={styles.button}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '90%',
    maxWidth: 400,
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    marginBottom: 0,
  },
});
