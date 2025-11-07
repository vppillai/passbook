/**
 * Deep linking configuration for email verification and password reset
 */
import { LinkingOptions } from '@react-navigation/native';
import { RootStackParamList } from '../types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'passbook://',
    'https://passbook.app',
    'https://www.passbook.app',
  ],
  config: {
    screens: {
      EmailVerification: {
        path: 'verify-email/:token',
        parse: {
          token: (token: string) => token,
        },
      },
      Login: {
        path: 'login',
      },
      Signup: {
        path: 'signup',
      },
      // Password reset deep link
      PasswordReset: {
        path: 'reset-password/:token',
        parse: {
          token: (token: string) => token,
        },
      },
    },
  },
};
