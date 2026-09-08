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
