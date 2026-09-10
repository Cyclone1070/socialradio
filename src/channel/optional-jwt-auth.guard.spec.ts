import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  it('returns user if authenticated successfully', () => {
    const user = { id: 'user-1', email: 'test@test.com' };
    const result = guard.handleRequest<{ id: string; email: string }>(
      null,
      user,
    );
    expect(result).toEqual(user);
  });

  it('returns null instead of throwing if no user or error is present', () => {
    const result = guard.handleRequest(null, null);
    expect(result).toBeNull();
  });

  it('returns null when an error occurs during token validation', () => {
    const result = guard.handleRequest(new Error('Invalid token'), null);
    expect(result).toBeNull();
  });
});
