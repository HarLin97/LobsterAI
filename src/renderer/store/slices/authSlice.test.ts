import { AuthSessionStatus } from '@shared/auth/constants';
import { describe, expect, test } from 'vitest';

import authReducer, {
  setAuthExpired,
  setAuthTemporarilyUnavailable,
  setLoggedIn,
} from './authSlice';

const user = {
  yid: 'user@example.com',
  nickname: 'Lobster User',
  avatarUrl: null,
};

const quota = {
  planName: '专业',
  subscriptionStatus: 'active',
  creditsLimit: 1_000,
  creditsUsed: 100,
  creditsRemaining: 900,
};

describe('auth session status', () => {
  test('preserves the authenticated snapshot during a temporary verification failure', () => {
    const loggedIn = authReducer(undefined, setLoggedIn({ user, quota }));
    const unavailable = authReducer(
      loggedIn,
      setAuthTemporarilyUnavailable({ hasCredentials: true }),
    );

    expect(unavailable).toMatchObject({
      isLoggedIn: true,
      isLoading: false,
      sessionStatus: AuthSessionStatus.TemporarilyUnavailable,
      user,
      quota,
    });
  });

  test('restores a cached user when startup verification is temporarily unavailable', () => {
    const unavailable = authReducer(
      undefined,
      setAuthTemporarilyUnavailable({
        hasCredentials: true,
        cachedUser: user,
      }),
    );

    expect(unavailable).toMatchObject({
      isLoggedIn: true,
      sessionStatus: AuthSessionStatus.TemporarilyUnavailable,
      user,
    });
  });

  test('clears user and quota after terminal expiration', () => {
    const loggedIn = authReducer(undefined, setLoggedIn({ user, quota }));
    const expired = authReducer(loggedIn, setAuthExpired());

    expect(expired).toMatchObject({
      isLoggedIn: false,
      isLoading: false,
      sessionStatus: AuthSessionStatus.Expired,
      user: null,
      quota: null,
    });
  });
});
