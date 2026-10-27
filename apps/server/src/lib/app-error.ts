export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly field?: string;

  constructor(code: string, httpStatus: number, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
