// Indus Agent - Google Authentication & Session Logic

export class AuthService {
  constructor(env, db) {
    this.env = env;
    this.db = db;
  }

  // Parse Cookie header
  static parseCookies(request) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = {};
    cookieHeader.split(';').forEach((part) => {
      const [name, ...rest] = part.trim().split('=');
      if (name) {
        cookies[name] = decodeURIComponent(rest.join('='));
      }
    });
    return cookies;
  }

  // Build Set-Cookie header
  static createSessionCookie(token, expiresAt, isSecure = false) {
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
    const secureFlag = isSecure ? '; Secure' : '';
    return `indus_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureFlag}`;
  }

  static createClearCookie(isSecure = false) {
    const secureFlag = isSecure ? '; Secure' : '';
    return `indus_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag}`;
  }

  // Generate Google OAuth 2.0 Authorization URL
  getGoogleAuthUrl(origin, state) {
    const clientId = this.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID is not configured in worker environment');
    }
    const redirectUri = `${origin}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      state: state || 'indus_auth'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  // Exchange OAuth code for tokens with Google
  async exchangeGoogleCode(code, origin) {
    const clientId = this.env.GOOGLE_CLIENT_ID;
    const clientSecret = this.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are missing');
    }

    const redirectUri = `${origin}/api/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error('Google token exchange failed:', errorText);
      throw new Error(`Google token exchange failed: ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    return tokenData;
  }

  // Get User Profile from Google using Access Token or ID Token
  async getGoogleUserInfo(accessToken, idToken) {
    // 1. Try Google UserInfo endpoint with Access Token
    if (accessToken) {
      try {
        const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const info = await res.json();
          return {
            id: info.sub,
            email: info.email,
            name: info.name || info.email.split('@')[0],
            picture: info.picture || null
          };
        }
      } catch (err) {
        console.warn('UserInfo fetch error:', err);
      }
    }

    // 2. Decode claims from id_token
    if (idToken) {
      const parts = idToken.split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          return {
            id: payload.sub,
            email: payload.email,
            name: payload.name || payload.email?.split('@')[0] || 'User',
            picture: payload.picture || null
          };
        } catch (e) {
          console.error('Failed to parse ID token payload', e);
        }
      }
    }

    throw new Error('Unable to extract user profile from Google tokens');
  }

  // Verify Google Identity Services (GSI) credential token (One-Tap / Google Sign-in button)
  async verifyGoogleCredential(credentialToken) {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credentialToken)}`);
    if (!res.ok) {
      throw new Error('Invalid Google credential token');
    }
    const payload = await res.json();

    // Check aud matches client id if configured
    if (this.env.GOOGLE_CLIENT_ID && payload.aud !== this.env.GOOGLE_CLIENT_ID) {
      console.warn('Google token audience mismatch:', payload.aud, 'expected:', this.env.GOOGLE_CLIENT_ID);
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null
    };
  }

  // Authenticate an incoming request (checks session cookie or Authorization Bearer header)
  async authenticateRequest(request) {
    // 1. Check Authorization header
    const authHeader = request.headers.get('Authorization') || '';
    let token = null;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    // 2. Fallback to session cookie
    if (!token) {
      const cookies = AuthService.parseCookies(request);
      token = cookies['indus_session'];
    }

    if (!token) {
      return null;
    }

    return await this.db.getSessionUser(token);
  }
}
