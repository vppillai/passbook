import React, { useState } from 'react';
import { ExpenseList } from './ExpenseList';
import { BalanceDisplay } from './BalanceDisplay';
import { FAB } from '../common/FAB';
import { ExpenseFormModal } from './ExpenseFormModal';
import type { Expense, ChildAccount } from '../../types/models';

interface ParentExpenseViewProps {
  child: ChildAccount;
  currency: string;
  onAddExpense: (expense: Partial<Expense>) => Promise<void>;
}

export const ParentExpenseView: React.FC<ParentExpenseViewProps> = ({
  child,
  currency,
  onAddExpense,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>();

  const handleEditClick = (expense: Expense) => {
    setEditingExpense(expense);
    setIsModalOpen(true);
  };

  return (
    <div>
      <BalanceDisplay balance={child.currentBalance} currency={currency} />
      
      <ExpenseList childAccountId={child.id} currency={currency} onEdit={handleEditClick} />

      <FAB onClick={() => {
        setEditingExpense(undefined);
        setIsModalOpen(true);
      }}>
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </FAB>

      <ExpenseFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpense(undefined);
        }}
        childAccountId={child.id}
        expense={editingExpense || null}
        onSuccess={() => {
          setEditingExpense(undefined);
          setIsModalOpen(false);
        }}
      />
    </div>
  );
};

