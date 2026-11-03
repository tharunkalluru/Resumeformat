export class FolioError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'FolioError'; }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Your previous project is still available.';
}
