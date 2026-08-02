/**
 * Operator authorization helper.
 *
 * An "operator" is an authenticated user whose ID appears in the
 * OPERATOR_USER_IDS environment variable (comma-separated).
 *
 * If OPERATOR_USER_IDS is not set or is an empty string, every
 * authenticated user is treated as an operator — convenient for
 * single-operator deploys that haven't configured the env var yet.
 *
 * To restrict access, set OPERATOR_USER_IDS to a comma-separated
 * list of Replit user IDs, e.g.:
 *   OPERATOR_USER_IDS=abc123,def456
 */

import type { Request } from "express";

/**
 * Pure function — extracts the allow-list from the env string and checks
 * whether a given user ID is an operator.
 *
 * Exported separately so it can be unit-tested without an HTTP context.
 *
 * Fails CLOSED: if OPERATOR_USER_IDS is absent, blank, or whitespace-only,
 * no user is treated as an operator. Access must be explicitly granted.
 */
export function checkIsOperator(userId: string, operatorIdsEnv: string | undefined): boolean {
  const ids = (operatorIdsEnv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // No list configured → deny all (fail closed)
  if (ids.length === 0) return false;

  return ids.includes(userId);
}

/**
 * Express request helper — returns true if the request is authenticated
 * AND the user is in the operator allow-list.
 */
export function isOperator(req: Request): boolean {
  if (!req.isAuthenticated()) return false;
  return checkIsOperator(req.user.id, process.env["OPERATOR_USER_IDS"]);
}
