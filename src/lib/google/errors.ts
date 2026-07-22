export class GoogleApiError extends Error {
  readonly code = 'GOOGLE_API_ERROR';
  readonly status?: number;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GoogleApiError';
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EventNotFoundError extends Error {
  readonly code = 'EVENT_NOT_FOUND';

  constructor(message = 'No matching calendar event was found.') {
    super(message);
    this.name = 'EventNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TaskNotFoundError extends Error {
  readonly code = 'TASK_NOT_FOUND';

  constructor(message = 'No matching task was found.') {
    super(message);
    this.name = 'TaskNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function getGoogleApiStatus(error: unknown) {
  const candidate = error as {
    code?: number | string;
    response?: {
      status?: number;
    };
  };
  const status = candidate.response?.status ?? candidate.code;

  return typeof status === 'number' ? status : undefined;
}

export function getGoogleApiMessage(error: unknown, fallback: string) {
  const candidate = error as {
    message?: string;
    response?: {
      data?: {
        error?: {
          message?: string;
        };
      };
    };
  };

  return candidate.response?.data?.error?.message ?? candidate.message ?? fallback;
}
