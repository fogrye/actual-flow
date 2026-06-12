import type { LunchFlowTransaction, ActualBudgetTransaction, AccountMapping } from './types';

export class TransactionMapper {
  private accountMappings: AccountMapping[];

  constructor(accountMappings: AccountMapping[]) {
    this.accountMappings = accountMappings;
  }

  private merchantSlug(merchant: string): string {
    return merchant
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);
  }

  /**
   * Generate a deterministic synthetic ID for pending transactions without an ID.
   * Uses account, date, amount, and merchant to create a unique identifier.
   */
  private generateSyntheticId(lfTransaction: LunchFlowTransaction): string {
    const amountCents = Math.round(lfTransaction.amount * 100);
    return `lf_pending_${lfTransaction.accountId}_${lfTransaction.date}_${amountCents}_${this.merchantSlug(lfTransaction.merchant)}`;
  }

  /**
   * Date-independent key used to reconcile a posted transaction with the
   * pending row it previously created. The pending->posted transition changes
   * both the imported_id (synthetic -> lf_<id>) and often the date, so the key
   * deliberately excludes the date and matches on account + amount + merchant.
   */
  private generateReconcileKey(actualBudgetAccountId: string, amountCents: number, merchant: string): string {
    return `${actualBudgetAccountId}_${amountCents}_${this.merchantSlug(merchant)}`;
  }

  /**
   * Compute the reconcile key for an already-imported Actual Budget transaction.
   * Mirrors generateReconcileKey using the stored account, amount and the raw
   * imported_payee (which equals the original merchant for Lunch Flow imports).
   */
  reconcileKeyForExisting(transaction: ActualBudgetTransaction): string {
    return this.generateReconcileKey(
      transaction.account,
      transaction.amount,
      transaction.imported_payee
    );
  }

  mapTransaction(lfTransaction: LunchFlowTransaction): ActualBudgetTransaction | null {
    const mapping = this.accountMappings.find(
      m => m.lunchFlowAccountId === lfTransaction.accountId
    );

    if (!mapping) {
      console.warn(`No mapping found for Lunch Flow account ${lfTransaction.accountId}`);
      return null;
    }

    const isPending = lfTransaction.isPending === true;
    const amount = parseInt((lfTransaction.amount * 100).toFixed(0));

    return {
      date: lfTransaction.date,
      // Forcing to fixed point integer to avoid floating point precision issues
      amount,
      payee_name: lfTransaction.merchant,
      imported_payee: lfTransaction.merchant,
      account: mapping.actualBudgetAccountId,
      cleared: !isPending, // false for pending, true for posted
      notes: isPending ? `[PENDING] ${lfTransaction.description}` : lfTransaction.description,
      imported_id: isPending ? this.generateSyntheticId(lfTransaction) : `lf_${lfTransaction.id}`,
      isPending: isPending, // Track pending status for UI display
      reconcileKey: this.generateReconcileKey(mapping.actualBudgetAccountId, amount, lfTransaction.merchant),
    };
  }

  mapTransactions(lfTransactions: LunchFlowTransaction[]): ActualBudgetTransaction[] {
    return lfTransactions
      .map(t => this.mapTransaction(t))
      .filter((t): t is ActualBudgetTransaction => t !== null);
  }
}
