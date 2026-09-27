import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const gmailEnabled = googleEnabled && process.env.ORBIT_GMAIL === "1";

const scope = ["openid", "email", "profile", ...(gmailEnabled ? ["https://www.googleapis.com/auth/gmail.readonly"] : [])].join(" ");

// The Google access token lives only inside the encrypted session cookie and is
// read server-side by /api/gmail/parcels; it is never sent to the browser.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: googleEnabled
    ? [Google({ authorization: { params: { scope, access_type: "offline", prompt: "consent" } } })]
    : [],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  callbacks: {
    jwt({ token, account }) {
      if (account?.access_token) {
        token.googleAccessToken = account.access_token;
        token.googleExpiresAt = account.expires_at;
      }
      return token;
    },
    session({ session }) {
      return session;
    },
  },
});
