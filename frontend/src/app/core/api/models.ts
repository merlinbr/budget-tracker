export interface AuthState {
  user: {
    id: number;
    username: string;
    displayName: string;
  };
  household: {
    id: number;
    name: string;
  };
}

export interface HouseholdMember {
  id: number;
  displayName: string;
  role: "owner" | "member";
  isActive: boolean;
}

export interface HouseholdDetails {
  id: number;
  name: string;
  members: HouseholdMember[];
}

export interface ExportFilters {
  from?: string;
  to?: string;
  accountId?: number;
  categoryId?: number;
}

export type AccountType = "checking" | "savings" | "credit_card" | "cash" | "other";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  initialBalance: number;
  balance: number;
  isArchived: boolean;
}

export interface AccountWrite {
  name: string;
  type: AccountType;
  initialBalance: number;
}

export type CategoryType = "expense" | "income";

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  isArchived: boolean;
}

export interface CategoryCreate {
  name: string;
  type: CategoryType;
}

export interface CategoryUpdate {
  name: string;
}
export type TransactionType = "expense" | "income";

export interface Transaction {
  id: number;
  accountId: number;
  categoryId: number;
  amount: number;
  description: string | null;
  transactionDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionWrite {
  accountId: number;
  categoryId: number;
  amount: number;
  description?: string | null;
  transactionDate: string;
}

export interface TransactionFilters {
  year?: number;
  month?: number;
  accountId?: number;
  categoryId?: number;
  type?: TransactionType;
  search?: string;
}

export interface DashboardPeriod {
  year: number;
  month: number;
}

export interface Budget {
  categoryId: number;
  categoryName: string;
  isArchived: boolean;
  year: number;
  month: number;
  limitAmount: number;
  spent: number;
  remaining: number;
  progress: number | null;
}

export interface BudgetWrite {
  limitAmount: number;
}

export interface BudgetCopyRequest {
  year: number;
  month: number;
  overwrite: boolean;
}

export interface DashboardSpending {
  categoryId: number;
  categoryName: string;
  spent: number;
}

export interface DashboardTransaction {
  id: number;
  accountId: number;
  accountName: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  description: string | null;
  transactionDate: string;
}

export interface DashboardResponse {
  period: DashboardPeriod;
  summary: { balance: number; income: number; expenses: number; net: number };
  budgets: Budget[];
  spendingByCategory: DashboardSpending[];
  recentTransactions: DashboardTransaction[];
}
