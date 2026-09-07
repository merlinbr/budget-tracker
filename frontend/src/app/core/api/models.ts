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
