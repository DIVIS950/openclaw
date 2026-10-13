import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

const clientId =
  Platform.select({
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    default: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  }) ?? '';

// Google native clients redirect to the reversed client id scheme.
const reversedClientId = clientId.split('.').reverse().join('.');

/** Google sign-in limited to read-only Gmail access. */
export function useGmailAuth() {
  const isWeb = Platform.OS === 'web';
  const redirectUri = AuthSession.makeRedirectUri({
    native: clientId ? `${reversedClientId}:/oauthredirect` : undefined,
  });
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      // Web clients can't exchange a code without a secret, so they use the token flow.
      responseType: isWeb ? AuthSession.ResponseType.Token : AuthSession.ResponseType.Code,
      usePKCE: !isWeb,
    },
    discovery,
  );
  const [accessToken, setAccessToken] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (response?.type === 'error') setError(response.error?.message ?? 'Sign-in failed');
    if (response?.type !== 'success') return;
    if (response.params.access_token) {
      setAccessToken(response.params.access_token);
      return;
    }
    AuthSession.exchangeCodeAsync(
      {
        clientId,
        code: response.params.code,
        redirectUri,
        extraParams: { code_verifier: request?.codeVerifier ?? '' },
      },
      discovery,
    )
      .then((t) => setAccessToken(t.accessToken))
      .catch((e: Error) => setError(e.message));
  }, [response, request, redirectUri]);

  return {
    configured: !!clientId,
    ready: !!request,
    accessToken,
    error,
    signIn: () => promptAsync(),
  };
}
