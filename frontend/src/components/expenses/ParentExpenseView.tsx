import React, { useState } from 'react';
import { ExpenseList } from './ExpenseList';
import { BalanceDisplay } from './BalanceDisplay';
import { FAB } from '../common/FAB';
import { ExpenseFormModal } from './ExpenseFormModal';
import type { Expense, ChildAccount } from '../../types/models';

interface ParentExpenseViewProps {
  child: ChildAccount;
  expenses: Expense[];
  currency: string;
  onAddExpense: (expense: Partial<Expense>) => Promise<void>;
}

export const ParentExpenseView: React.FC<ParentExpenseViewProps> = ({
  child,
  expenses,
  currency,
  onAddExpense,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>();

  const handleEditClick = (expense: Expense) => {
    setEditingExpense(expense);
    setIsModalOpen(true);
  };

  const handleSubmit = async (expenseData: Partial<Expense>) => {
    await onAddExpense(expenseData);
    setEditingExpense(undefined);
  };

  return (
    <div>
      <BalanceDisplay balance={child.currentBalance} currency={currency} />
      
      <ExpenseList expenses={expenses} currency={currency} onEdit={handleEditClick} />

      <FAB onClick={() => {
        setEditingExpense(undefined);
        setIsModalOpen(true);
      }} />

      <ExpenseFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpense(undefined);
        }}
        onSubmit={handleSubmit}
        initialExpense={editingExpense}
        currency={currency}
      />
    </div>
  );
};

