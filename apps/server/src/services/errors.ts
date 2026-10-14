import type { FieldErrors } from '@osuite/kernel';

/** An error with an HTTP status and optional per-field messages for the UI. */
export class RecordError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}
