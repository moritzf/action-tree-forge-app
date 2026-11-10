export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

// Only a definitive Jira rejection makes it safe to release a creation claim.
export function isDefinitiveRejection(error: unknown): boolean {
  return error instanceof Error && 'definitive' in error && error.definitive === true;
}
