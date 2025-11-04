/**
 * Cookie utility functions for secure authentication token storage
 */

const AUTH_TOKEN_COOKIE = 'authToken';
const USER_ID_COOKIE = 'userId';
const USER_TYPE_COOKIE = 'userType';
const PASSWORD_CHANGED_AT_COOKIE = 'passwordChangedAt';

/**
 * Set a cookie with optional expiration
 */
export function setCookie(
  name: string,
  value: string,
  days?: number,
  options: {
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    path?: string;
  } = {}
): void {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (days !== undefined) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    cookie += `; expires=${date.toUTCString()}`;
  }

  cookie += `; path=${options.path || '/'}`;
  
  if (options.secure || window.location.protocol === 'https:') {
    cookie += '; secure';
  }

  cookie += `; SameSite=${options.sameSite || 'Lax'}`;

  document.cookie = cookie;
}

/**
 * Get a cookie value by name
 */
export function getCookie(name: string): string | null {
  const nameEQ = encodeURIComponent(name) + '=';
  const cookies = document.cookie.split(';');

  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i];
    while (cookie.charAt(0) === ' ') {
      cookie = cookie.substring(1, cookie.length);
    }
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length, cookie.length));
    }
  }
  return null;
}

/**
 * Delete a cookie by setting it to expire in the past
 */
export function deleteCookie(name: string, path: string = '/'): void {
  document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${path}; SameSite=Lax`;
}

/**
 * Auth token cookie helpers
 */
export const authCookies = {
  setToken: (token: string, rememberMe: boolean = false) => {
    // 7 days for "Remember Me", session cookie otherwise
    setCookie(AUTH_TOKEN_COOKIE, token, rememberMe ? 7 : undefined, {
      secure: true,
      sameSite: 'Strict',
    });
  },

  getToken: (): string | null => {
    return getCookie(AUTH_TOKEN_COOKIE);
  },

  setUserId: (userId: string, rememberMe: boolean = false) => {
    setCookie(USER_ID_COOKIE, userId, rememberMe ? 7 : undefined, {
      secure: true,
      sameSite: 'Strict',
    });
  },

  getUserId: (): string | null => {
    return getCookie(USER_ID_COOKIE);
  },

  setUserType: (userType: string, rememberMe: boolean = false) => {
    setCookie(USER_TYPE_COOKIE, userType, rememberMe ? 7 : undefined, {
      secure: true,
      sameSite: 'Strict',
    });
  },

  getUserType: (): string | null => {
    return getCookie(USER_TYPE_COOKIE);
  },

  setPasswordChangedAt: (timestamp: string, rememberMe: boolean = false) => {
    setCookie(PASSWORD_CHANGED_AT_COOKIE, timestamp, rememberMe ? 7 : undefined, {
      secure: true,
      sameSite: 'Strict',
    });
  },

  getPasswordChangedAt: (): string | null => {
    return getCookie(PASSWORD_CHANGED_AT_COOKIE);
  },

  clearAll: () => {
    deleteCookie(AUTH_TOKEN_COOKIE);
    deleteCookie(USER_ID_COOKIE);
    deleteCookie(USER_TYPE_COOKIE);
    deleteCookie(PASSWORD_CHANGED_AT_COOKIE);
  },
};

