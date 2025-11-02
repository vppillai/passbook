import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/common/Layout';
import { useAuth } from '../../contexts/auth.context';
import { parentStorage } from '../../services/storage/parent.storage';
import { ThemeToggle } from '../../components/settings/ThemeToggle';
import { AccountingPeriodEditor } from '../../components/settings/AccountingPeriodEditor';
import { NewPeriodStarter } from '../../components/settings/NewPeriodStarter';
import { CurrencySelector } from '../../components/common/CurrencySelector';
import { Button } from '../../components/common/Button';
import type { ParentAccount, AccountingPeriodType } from '../../types/models';

export const Settings = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [parent, setParent] = useState<ParentAccount | null>(null);
  const [periodType, setPeriodType] = useState<AccountingPeriodType>('monthly');
  const [startDay, setStartDay] = useState(1);
  const [currency, setCurrency] = useState('CAD');
  const [isNewPeriodModalOpen, setIsNewPeriodModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.type === 'parent') {
      loadParentData();
    } else {
      setLoading(false);
    }
  }, [user]);

  const loadParentData = async () => {
    if (!user) return;

    try {
      const parentAccount = await parentStorage.getById(user.id);
      if (parentAccount) {
        setParent(parentAccount);
        setPeriodType(parentAccount.accountingPeriodType);
        setStartDay(parentAccount.accountingPeriodStartDay);
        setCurrency(parentAccount.currency);
      }
    } catch (error) {
      console.error('Failed to load parent data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!parent) return;

    setIsSaving(true);
    setSaveMessage('');

    try {
      await parentStorage.update(parent.id, {
        accountingPeriodType: periodType,
        accountingPeriodStartDay: startDay,
        currency: currency,
      });

      // Reload parent data to reflect changes
      await loadParentData();
      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Failed to save settings. Please try again.');
      console.error('Failed to save settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Settings" showBack onBack={() => navigate(-1)}>
        <div className="max-w-3xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-8"></div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="space-y-6">
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
                <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // For child accounts, show simplified settings
  if (user?.type === 'child') {
    return (
      <Layout title="Settings" showBack onBack={() => navigate(-1)}>
        <div className="space-y-6 max-w-2xl">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
              Appearance
            </h2>
            <ThemeToggle />
          </div>
        </div>
      </Layout>
    );
  }

  // For parent accounts, show full settings
  if (!parent) return null;

  return (
    <Layout title="Settings" showBack onBack={() => navigate(-1)}>
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Settings</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your account preferences and accounting periods
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Appearance
            </h3>
            <ThemeToggle />
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Currency Settings
            </h3>
            <CurrencySelector value={currency} onChange={setCurrency} />
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Accounting Period
            </h3>
            <AccountingPeriodEditor
              periodType={periodType}
              startDay={startDay}
              onPeriodTypeChange={setPeriodType}
              onStartDayChange={setStartDay}
            />
          </div>

          {saveMessage && (
            <div
              className={`p-3 rounded-lg ${
                saveMessage.includes('success')
                  ? 'bg-green-50 dark:bg-green-900 text-green-700 dark:text-green-300'
                  : 'bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-300'
              }`}
            >
              {saveMessage}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} variant="primary" isLoading={isSaving}>
              Save Settings
            </Button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Period Management
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Start a new accounting period. This will close the current period and reset all child
            balances to their default monthly allowance.
          </p>
          <Button
            onClick={() => setIsNewPeriodModalOpen(true)}
            variant="danger"
          >
            Start New Period
          </Button>
        </div>

        <NewPeriodStarter
          isOpen={isNewPeriodModalOpen}
          onClose={() => setIsNewPeriodModalOpen(false)}
          onSuccess={() => {
            setIsNewPeriodModalOpen(false);
            window.location.reload(); // Reload to refresh data
          }}
          parentAccountId={parent.id}
        />
      </div>
    </Layout>
  );
};

