import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Button } from '../../components/common/Button';
import { AddFundsModal } from '../../components/funds/AddFundsModal';
import { ExpenseList } from '../../components/expenses/ExpenseList';
import { ExpenseFormModal } from '../../components/expenses/ExpenseFormModal';
import { BalanceDisplay } from '../../components/expenses/BalanceDisplay';
import { db } from '../../services/storage/db';
import type { ChildAccount, Expense } from '../../types/models';

export const ChildDetailView = () => {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [childAccount, setChildAccount] = useState<ChildAccount | null>(null);
  const [currency, setCurrency] = useState<string>('CAD');
  const [loading, setLoading] = useState(true);
  const [showAddFundsModal, setShowAddFundsModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);

  useEffect(() => {
    if (childId) {
      loadChildAccount();
    }
  }, [childId]);

  const loadChildAccount = async () => {
    if (!childId) return;

    try {
      const account = await db.childAccounts.get(childId);
      if (account && user?.type === 'parent' && account.parentAccountId === user.id) {
        setChildAccount(account);
        // Load parent account to get currency
        const parentAccount = await db.parentAccounts.get(user.id);
        if (parentAccount) {
          setCurrency(parentAccount.currency);
        }
      } else {
        navigate('/parent/dashboard');
      }
    } catch (error) {
      console.error('Failed to load child account:', error);
      navigate('/parent/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = () => {
    loadChildAccount();
  };

  const handleEditExpense = (expense: Expense) => {
    setExpenseToEdit(expense);
    setShowAddExpenseModal(true);
  };

  if (loading) {
    return (
      <Layout title="Child Details" showBack onBack={() => navigate('/parent/dashboard')}>
        <LoadingSpinner size="lg" className="py-12" />
      </Layout>
    );
  }

  if (!childAccount) {
    return (
      <Layout title="Child Details" showBack onBack={() => navigate('/parent/dashboard')}>
        <div className="text-center text-gray-600 dark:text-gray-400">Child account not found</div>
      </Layout>
    );
  }

  return (
    <Layout
      title={childAccount.name}
      showBack
      onBack={() => navigate('/parent/dashboard')}
    >
      <div className="space-y-6">
        <BalanceDisplay balance={childAccount.currentBalance} currency={currency} />

        <div className="flex space-x-4">
          <Button onClick={() => setShowAddFundsModal(true)} className="flex-1">
            Add Funds
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExpenseToEdit(null);
              setShowAddExpenseModal(true);
            }}
            className="flex-1"
          >
            Add Expense
          </Button>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Expense History
          </h2>
          <ExpenseList childAccountId={childAccount.id} currency={currency} onEdit={handleEditExpense} />
        </div>
      </div>

      <AddFundsModal
        isOpen={showAddFundsModal}
        onClose={() => setShowAddFundsModal(false)}
        childAccountId={childAccount.id}
        onSuccess={handleSuccess}
      />

      <ExpenseFormModal
        isOpen={showAddExpenseModal}
        onClose={() => {
          setShowAddExpenseModal(false);
          setExpenseToEdit(null);
        }}
        childAccountId={childAccount.id}
        expense={expenseToEdit}
        onSuccess={handleSuccess}
      />
    </Layout>
  );
};

