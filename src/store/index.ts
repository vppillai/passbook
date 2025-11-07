/**
 * Zustand store configuration and slices
 */
import { create } from 'zustand';
import { AuthState, ChildrenState, ExpensesState } from '../types';

// Auth Store
interface AuthStore extends AuthState {
  setAuth: (token: string, user: any, familyId?: string) => void;
  clearAuth: () => void;
  updateUser: (user: any) => void;
}

// Extend user type to include userType
declare module '../types' {
  interface ParentAccount {
    userType?: 'parent';
  }
  interface ChildAccount {
    userType?: 'child';
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  isAuthenticated: false,
  user: null,
  token: null,
  familyId: null,
  setAuth: (token, user, familyId) =>
    set({
      isAuthenticated: true,
      token,
      user,
      familyId: familyId || null,
    }),
  clearAuth: () =>
    set({
      isAuthenticated: false,
      user: null,
      token: null,
      familyId: null,
    }),
  updateUser: (user) =>
    set((state) => ({
      user: { ...state.user, ...user },
    })),
}));

// Children Store
interface ChildrenStore extends ChildrenState {
  setChildren: (children: any[]) => void;
  addChild: (child: any) => void;
  updateChild: (childId: string, updates: Partial<any>) => void;
  removeChild: (childId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useChildrenStore = create<ChildrenStore>((set) => ({
  children: [],
  loading: false,
  error: null,
  setChildren: (children) => set({ children }),
  addChild: (child) =>
    set((state) => ({
      children: [...state.children, child],
    })),
  updateChild: (childId, updates) =>
    set((state) => ({
      children: state.children.map((child) =>
        child.userId === childId ? { ...child, ...updates } : child
      ),
    })),
  removeChild: (childId) =>
    set((state) => ({
      children: state.children.filter((child) => child.userId !== childId),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

// Expenses Store
interface ExpensesStore extends ExpensesState {
  setExpenses: (expenses: any[]) => void;
  addExpense: (expense: any) => void;
  updateExpense: (expenseId: string, updates: Partial<any>) => void;
  removeExpense: (expenseId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useExpensesStore = create<ExpensesStore>((set) => ({
  expenses: [],
  loading: false,
  error: null,
  setExpenses: (expenses) => set({ expenses }),
  addExpense: (expense) =>
    set((state) => ({
      expenses: [expense, ...state.expenses],
    })),
  updateExpense: (expenseId, updates) =>
    set((state) => ({
      expenses: state.expenses.map((expense) =>
        expense.transactionId === expenseId ? { ...expense, ...updates } : expense
      ),
    })),
  removeExpense: (expenseId) =>
    set((state) => ({
      expenses: state.expenses.filter(
        (expense) => expense.transactionId !== expenseId
      ),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
