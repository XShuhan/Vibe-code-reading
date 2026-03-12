import { createSession, validateSession, revokeToken } from './auth';

describe('Auth Module', () => {
  describe('createSession', () => {
    it('creates a session and returns a token', () => {
      const token = createSession('user-123');
      expect(token).toBeTruthy();
      expect(token.startsWith('token-')).toBe(true);
    });

    it('throws error for empty userId', () => {
      expect(() => createSession('')).toThrow('userId is required');
      expect(() => createSession('   ')).toThrow('userId is required');
    });
  });

  describe('validateSession', () => {
    it('returns userId for valid token', () => {
      const token = createSession('user-456');
      const userId = validateSession(token);
      expect(userId).toBe('user-456');
    });

    it('returns null for invalid token', () => {
      const userId = validateSession('invalid-token');
      expect(userId).toBeNull();
    });
  });

  describe('revokeToken', () => {
    it('revokes an active session', () => {
      const token = createSession('user-789');
      expect(validateSession(token)).toBe('user-789');
      
      revokeToken(token);
      expect(validateSession(token)).toBeNull();
    });
  });
});
