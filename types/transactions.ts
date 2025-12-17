export type TransactionKind =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'asset'
  | 'liability';

export type TransactionStatus = 'cleared' | 'pending' | 'reconciled';

export type TransactionSource = 'csv' | 'manual' | 'ai';

export interface Transaction {
  id: string;
  date: string; // ISO date (YYYY-MM-DD)
  description: string;
  category: string | null;
  amount: number;
  type: TransactionKind | null;
  account: string | null;
  status: TransactionStatus | null;
  source: TransactionSource | null;
  notes: string | null;
  user_id?: string;
  business_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}


