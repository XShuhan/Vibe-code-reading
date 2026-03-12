/**
 * Authentication and session management module.
 * 
 * Handles user authentication, session creation, and token validation.
 * This is a critical security component - all functions should be reviewed
 * for security implications before deployment.
 */

/** Token expiration time in milliseconds (24 hours) */
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** In-memory store for active sessions (use Redis in production) */
const activeSessions = new Map<string, SessionData>();

interface SessionData {
  userId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Creates a new session for the given user.
 * 
 * @param userId - The unique identifier for the user
 * @returns The session token
 * @throws Error if userId is empty
 * 
 * @example
 * ```typescript
 * const token = createSession('user-123');
 * console.log(token); // "token-abc123..."
 * ```
 */
export function createSession(userId: string): string {
  if (!userId || userId.trim() === '') {
    throw new Error('userId is required');
  }

  const token = issueToken(userId);
  const now = Date.now();
  
  activeSessions.set(token, {
    userId,
    token,
    createdAt: now,
    expiresAt: now + TOKEN_EXPIRY_MS
  });

  return token;
}

/**
 * Issues a cryptographically secure token for the user.
 * 
 * In production, this should use a proper JWT library or
 * cryptographically secure random token generation.
 * 
 * @param userId - The user to issue token for
 * @returns A unique token string
 */
export function issueToken(userId: string): string {
  // Simple implementation for demo - use crypto in production
  const randomPart = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now().toString(36);
  return `token-${userId}-${randomPart}-${timestamp}`;
}

/**
 * Validates a session token and returns the associated user ID.
 * 
 * @param token - The session token to validate
 * @returns The user ID if valid, null otherwise
 */
export function validateSession(token: string): string | null {
  const session = activeSessions.get(token);
  
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }

  return session.userId;
}

/**
 * Revokes a session token, effectively logging the user out.
 * 
 * @param token - The token to revoke
 * @returns true if a session was found and removed
 */
export function revokeToken(token: string): boolean {
  return activeSessions.delete(token);
}

/**
 * Gets all active sessions for a user.
 * Useful for "log out everywhere" functionality.
 * 
 * @param userId - The user to look up
 * @returns Array of active tokens
 */
export function getUserSessions(userId: string): string[] {
  const sessions: string[] = [];
  
  for (const [token, data] of activeSessions.entries()) {
    if (data.userId === userId && Date.now() <= data.expiresAt) {
      sessions.push(token);
    }
  }
  
  return sessions;
}
