interface ProviderError { message: string; code?: string; details?: string }

export class DatabaseOperationError extends Error {
  readonly code: string;
  readonly operation: string;

  constructor(operation: string, error: ProviderError) {
    // Call sites supply static operation/table labels, never record IDs or values.
    const safeOperation = /^[a-z_ ]{1,80}$/.test(operation) ? operation : 'database operation';
    super(`Supabase could not ${safeOperation}.`);
    this.name = 'DatabaseOperationError';
    this.operation = safeOperation;
    const code = error.code ?? '';
    this.code = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code) ? code
      : /timeout|timed out|deadline exceeded/i.test(error.message) ? 'database_timeout'
      : /fetch failed|network error|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message) ? 'database_network_error'
      : 'database_error';
  }
}
