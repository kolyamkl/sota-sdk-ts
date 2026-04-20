export enum ErrorCode {
  TIMEOUT = "timeout",
  RESOURCE_UNAVAILABLE = "resource_unavailable",
  AUTHENTICATION_FAILED = "authentication_failed",
  INVALID_INPUT = "invalid_input",
  INTERNAL_ERROR = "internal_error",
  RATE_LIMITED = "rate_limited",
}

export class AgentError extends Error {
  code: ErrorCode;
  partialResult?: string;
  retryable: boolean;
  debugInfo: Record<string, unknown>;

  constructor(options: {
    code: ErrorCode;
    message: string;
    partialResult?: string;
    retryable?: boolean;
    debugInfo?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "AgentError";
    this.code = options.code;
    this.partialResult = options.partialResult;
    this.retryable = options.retryable ?? false;
    this.debugInfo = options.debugInfo ?? {};
  }
}
