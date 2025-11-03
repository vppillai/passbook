import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Button } from '../../components/common/Button';
import { AddFundsModal } from '../../components/funds/AddFundsModal';
import { ExpenseList } from '../../components/expenses/ExpenseList';
import { ExpenseFormModal } from '../../components/expenses/ExpenseFormModal';
import { ConfirmDeleteModal } from '../../components/common/ConfirmDeleteModal';
import { formatCurrencyWithSign } from '../../utils/currency';
import { db } from '../../services/storage/db';
import { expenseService } from '../../services/expenses/expense.service';
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    setRefreshTrigger(prev => prev + 1); // Trigger expense list refresh
  };

  const handleEditExpense = (expense: Expense) => {
    setExpenseToEdit(expense);
    setShowAddExpenseModal(true);
  };

  const handleDeleteExpense = (expense: Expense) => {
    setExpenseToDelete(expense);
    setShowDeleteModal(true);
  };

  const confirmDeleteExpense = async () => {
    if (!expenseToDelete) return;

    setDeleteLoading(true);
    try {
      await expenseService.deleteExpense(expenseToDelete.id);
      setShowDeleteModal(false);
      setExpenseToDelete(null);
      loadChildAccount(); // Refresh balance
      setRefreshTrigger(prev => prev + 1); // Trigger expense list refresh
    } catch (error) {
      console.error('Failed to delete expense:', error);
      // TODO: Add toast notification for error
    } finally {
      setDeleteLoading(false);
    }
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
      <div className="space-y-6 sm:space-y-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 sm:p-8">
          <div className="text-center">
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
              Current Balance
            </p>
            <p
              className={`text-3xl sm:text-4xl font-bold ${
                childAccount.currentBalance < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-900 dark:text-gray-100'
              }`}
              aria-live="polite"
              aria-atomic="true"
            >
              {formatCurrencyWithSign(childAccount.currentBalance, currency)}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
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

        <div className="space-y-4 sm:space-y-6">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Expense History
          </h2>
          <ExpenseList
            childAccountId={childAccount.id}
            currency={currency}
            onEdit={handleEditExpense}
            refreshTrigger={refreshTrigger}
          />
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
        onDelete={handleDeleteExpense}
      />

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setExpenseToDelete(null);
        }}
        onConfirm={confirmDeleteExpense}
        title="Delete Expense"
        message="Are you sure you want to delete this expense? This action cannot be undone and will restore the amount to the child's balance."
        itemName={expenseToDelete?.description}
        loading={deleteLoading}
      />
    </Layout>
  );
};

