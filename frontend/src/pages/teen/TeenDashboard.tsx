import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { FAB } from '../../components/common/FAB';
import { BalanceDisplay } from '../../components/expenses/BalanceDisplay';
import { ExpenseList } from '../../components/expenses/ExpenseList';
import { ExpenseFormModal } from '../../components/expenses/ExpenseFormModal';
import { NegativeBalanceWarning } from '../../components/expenses/NegativeBalanceWarning';
import { ConfirmDeleteModal } from '../../components/common/ConfirmDeleteModal';
import { db } from '../../services/storage/db';
import { expenseService } from '../../services/expenses/expense.service';
import type { ChildAccount, Expense } from '../../types/models';

export const TeenDashboard = () => {
  const { user } = useAuth();
  const [account, setAccount] = useState<ChildAccount | null>(null);
  const [currency, setCurrency] = useState<string>('CAD');
  const [loading, setLoading] = useState(true);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    if (user?.type === 'child') {
      loadAccount();
    }
  }, [user]);

  const loadAccount = async () => {
    if (user?.type !== 'child') return;

    try {
      const childAccount = await db.childAccounts.get(user.id);
      if (childAccount) {
        setAccount(childAccount);
        // Load parent account to get currency
        const parentAccount = await db.parentAccounts.get(childAccount.parentAccountId);
        if (parentAccount) {
          setCurrency(parentAccount.currency);
        }
      } else {
        setAccount(null);
      }
    } catch (error) {
      console.error('Failed to load account:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExpenseSuccess = () => {
    loadAccount();
    setRefreshTrigger(prev => prev + 1); // Trigger expense list refresh
  };

  const handleEditExpense = (expense: Expense) => {
    setExpenseToEdit(expense);
    setShowExpenseModal(true);
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
      loadAccount(); // Refresh balance
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
      <Layout title="My Passbook">
        <LoadingSpinner size="lg" className="py-12" />
      </Layout>
    );
  }

  if (!account) {
    return (
      <Layout title="My Passbook">
        <div className="text-center text-gray-600 dark:text-gray-400">Account not found</div>
      </Layout>
    );
  }

  return (
    <Layout title="My Passbook">
      <BalanceDisplay balance={account.currentBalance} currency={currency} />
      {account.currentBalance < 0 && (
        <NegativeBalanceWarning balance={account.currentBalance} currency={currency} />
      )}
      <ExpenseList
        childAccountId={account.id}
        currency={currency}
        onEdit={handleEditExpense}
        onDelete={handleDeleteExpense}
        refreshTrigger={refreshTrigger}
      />
      <FAB
        onClick={() => {
          setExpenseToEdit(null);
          setShowExpenseModal(true);
        }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </FAB>

      <ExpenseFormModal
        isOpen={showExpenseModal}
        onClose={() => {
          setShowExpenseModal(false);
          setExpenseToEdit(null);
        }}
        childAccountId={account.id}
        expense={expenseToEdit}
        onSuccess={handleExpenseSuccess}
      />

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setExpenseToDelete(null);
        }}
        onConfirm={confirmDeleteExpense}
        title="Delete Expense"
        message="Are you sure you want to delete this expense? This action cannot be undone and will restore the amount to your balance."
        itemName={expenseToDelete?.description}
        loading={deleteLoading}
      />
    </Layout>
  );
};

