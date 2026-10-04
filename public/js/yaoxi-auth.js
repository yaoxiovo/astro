/**
 * yaoxi-auth.js - 耀西统一身份认证中心客户端 SDK
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.YaoxiAuth = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SSO_URL = 'https://accounts.yaoxi.cloud';
  const SSO_HANDSHAKE_SECRET = 'yaoxi_sso_handshake_secret_key_v1_auth_guard_2026';

  class YaoxiAuth {
    constructor(options = {}) {
      this.clientId = options.clientId || 'yaoxi-blog';
      this.authUrl = options.authUrl || DEFAULT_SSO_URL;
      this.redirectUri = options.redirectUri || window.location.href.split('#')[0];
      this.targetDomain = options.targetDomain || window.location.hostname;
      this.mode = options.mode || 'popup';
      this.scope = options.scope || 'openid profile email admin';
      this.storagePrefix = 'yaoxi_auth_';
      this._popupWindow = null;
    }

    async createSignedHandshakeToken() {
      const timestamp = Date.now().toString();
      const nonce = Math.random().toString(36).substring(2, 10);
      const payload = `v1.${timestamp}.${nonce}.${this.targetDomain}`;

      if (window.crypto && window.crypto.subtle) {
        try {
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey(
            'raw',
            enc.encode(SSO_HANDSHAKE_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
          const sigHex = Array.from(new Uint8Array(sigBuf))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .substring(0, 32);

          return `crt.v1.${timestamp}.${nonce}.${sigHex}`;
        } catch (e) {}
      }
      return `crt.v1.${timestamp}.${nonce}.sigfallback`;
    }

    async login(overrideOptions = {}) {
      const mode = overrideOptions.mode || this.mode;
      const clientRequestToken = await this.createSignedHandshakeToken();

      const params = new URLSearchParams({
        client_id: this.clientId,
        target_domain: this.targetDomain,
        redirect_uri: this.redirectUri,
        client_request_token: clientRequestToken,
        response_type: 'token',
        scope: this.scope,
        state: 'st_' + Math.random().toString(36).substring(2, 10)
      });

      const ssoTargetUrl = `${this.authUrl.replace(/\/$/, '')}/accounts-login.html?${params.toString()}`;

      if (mode === 'redirect') {
        sessionStorage.setItem(this.storagePrefix + 'pending_token', clientRequestToken);
        window.location.href = ssoTargetUrl;
        return new Promise(() => {});
      }

      return new Promise((resolve, reject) => {
        const width = 1060;
        const height = 620;
        const left = Math.max(0, (window.screen.width - width) / 2);
        const top = Math.max(0, (window.screen.height - height) / 2);

        this._popupWindow = window.open(
          ssoTargetUrl,
          'yaoxi_sso_popup',
          `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no,location=yes,status=no,resizable=yes,scrollbars=yes`
        );

        if (!this._popupWindow || this._popupWindow.closed) {
          return reject(new Error('浏览器拦截了弹窗，请允许弹出窗口后重试'));
        }

        const handleMessage = (event) => {
          try {
            const expectedOrigin = new URL(this.authUrl).origin;
            if (event.origin !== expectedOrigin && event.origin !== 'https://accounts.yaoxi.cloud') {
              return;
            }
          } catch (e) {
            if (event.origin !== 'https://accounts.yaoxi.cloud') return;
          }

          const data = event.data;
          if (!data || data.type !== 'YAOXI_SSO_SIGNATURE_CALLBACK') return;
          if (data.client_request_token !== clientRequestToken) return;

          window.removeEventListener('message', handleMessage);
          clearInterval(pollTimer);

          if (this._popupWindow && !this._popupWindow.closed) {
            this._popupWindow.close();
          }

          const bundle = data.tokenBundle || {};
          const accessToken = bundle.access_token || data.signed_token;
          const user = bundle.user || this.parseJwtPayload(accessToken);

          this._saveAuthData(accessToken, user, bundle.expires_in || 7200, bundle);

          const rawRole = String(user.role || '').toLowerCase();
          const roles = Array.isArray(user.roles) ? user.roles.map((r) => String(r).toLowerCase()) : [];
          if (rawRole === 'admin' || roles.includes('admin') || user.is_admin === true) {
            this.syncCredentials().catch(() => {});
          }

          resolve({
            user,
            accessToken,
            idToken: bundle.id_token || accessToken,
            signature: data.signature || bundle.signature,
            expiresIn: bundle.expires_in || 7200
          });
        };

        window.addEventListener('message', handleMessage);

        const pollTimer = setInterval(() => {
          if (this._popupWindow && this._popupWindow.closed) {
            clearInterval(pollTimer);
            window.removeEventListener('message', handleMessage);
            reject(new Error('用户取消了登录或关闭了认证窗口'));
          }
        }, 800);
      });
    }

    handleCallback() {
      const hash = window.location.hash.substring(1);
      if (!hash) return null;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      if (!accessToken) return null;

      const user = this.parseJwtPayload(accessToken);
      const expiresIn = parseInt(params.get('expires_in'), 10) || 7200;
      const extraBundle = {
        github_pat: params.get('github_pat') || params.get('pat') || undefined,
        cf_token: params.get('cf_token') || undefined,
        cf_zone_id: params.get('cf_zone_id') || undefined,
      };

      this._saveAuthData(accessToken, user, expiresIn, extraBundle);

      const rawRole = String(user.role || '').toLowerCase();
      const roles = Array.isArray(user.roles) ? user.roles.map((r) => String(r).toLowerCase()) : [];
      if (rawRole === 'admin' || roles.includes('admin') || user.is_admin === true) {
        this.syncCredentials().catch(() => {});
      }

      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
      }
      return { user, accessToken, expiresIn };
    }

    isAuthenticated() {
      return !!this.getToken();
    }

    getUser() {
      const token = this.getToken();
      if (!token) return null;
      try {
        const userJson = localStorage.getItem(this.storagePrefix + 'user');
        return userJson ? JSON.parse(userJson) : null;
      } catch (e) {
        return null;
      }
    }

    getToken() {
      const token = localStorage.getItem(this.storagePrefix + 'token') || localStorage.getItem('yaoxi_access_token');
      const expStr = localStorage.getItem(this.storagePrefix + 'exp');
      if (!token) return null;
      if (expStr) {
        const expTime = parseInt(expStr, 10);
        if (Date.now() >= expTime) {
          this.logout();
          return null;
        }
      }
      return token;
    }

    logout() {
      localStorage.removeItem(this.storagePrefix + 'token');
      localStorage.removeItem(this.storagePrefix + 'user');
      localStorage.removeItem(this.storagePrefix + 'exp');
      localStorage.removeItem('yaoxi_access_token');
      localStorage.removeItem('access_token');
      localStorage.removeItem('yaoxi_user_id');
      localStorage.removeItem('user_id');
      localStorage.removeItem('yaoxi_github_pat');
      localStorage.removeItem('yaoxi_admin_github_pat');
      localStorage.removeItem('yaoxi_ddos_cf_token');
      localStorage.removeItem('yaoxi_ddos_cf_zone_id');
      try {
        localStorage.removeItem('user_profile');
        localStorage.removeItem('yaoxi_client_token');
        localStorage.removeItem('yaoxi_client_user');
      } catch (e) {}
    }

    _saveAuthData(token, user, expiresInSec = 7200, extraBundle = {}) {
      const expTime = Date.now() + expiresInSec * 1000;
      const userId = (user && (user.sub || user.id || user.userId)) || '';

      localStorage.setItem(this.storagePrefix + 'token', token);
      localStorage.setItem(this.storagePrefix + 'user', JSON.stringify(user));
      localStorage.setItem(this.storagePrefix + 'exp', expTime.toString());

      // 统一部署全局凭据字段，彻底联通 AdminPublish 与 EncryptedReader
      localStorage.setItem('yaoxi_access_token', token);
      localStorage.setItem('access_token', token);
      if (userId) {
        localStorage.setItem('yaoxi_user_id', String(userId));
        localStorage.setItem('user_id', String(userId));
      }

      // 自动解包随认证中心一并下发的运维凭据 (GitHub PAT / CF Token / Zone ID)
      const source = Object.assign({}, extraBundle, user || {});
      const githubPat = source.github_pat || source.github_token || source.pat;
      const cfToken = source.cf_token || source.cloudflare_token;
      const cfZoneId = source.cf_zone_id || source.cf_zone;

      if (githubPat) {
        localStorage.setItem('yaoxi_github_pat', githubPat);
        localStorage.setItem('yaoxi_admin_github_pat', githubPat);
      }
      if (cfToken) {
        localStorage.setItem('yaoxi_ddos_cf_token', cfToken);
      }
      if (cfZoneId) {
        localStorage.setItem('yaoxi_ddos_cf_zone_id', cfZoneId);
      }

      try {
        localStorage.setItem('user_profile', JSON.stringify(user));
        localStorage.setItem('yaoxi_client_token', token);
        localStorage.setItem('yaoxi_client_user', JSON.stringify(user));
      } catch (e) {}
    }

    /**
     * 随认证中心一并拉取并下发博主全量运维与发布凭据 (GET /api/credentials)
     */
    async syncCredentials(apiBase = 'https://zk-api.yaoxi.cloud') {
      const token = this.getToken();
      if (!token) return null;
      try {
        const url = `${apiBase.replace(/\/$/, '')}/api/credentials`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.success && data.credentials) {
          const creds = data.credentials;
          if (creds.github_pat) {
            localStorage.setItem('yaoxi_github_pat', creds.github_pat);
            localStorage.setItem('yaoxi_admin_github_pat', creds.github_pat);
          }
          if (creds.cf_token) {
            localStorage.setItem('yaoxi_ddos_cf_token', creds.cf_token);
          }
          if (creds.cf_zone_id) {
            localStorage.setItem('yaoxi_ddos_cf_zone_id', creds.cf_zone_id);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('yaoxi:credentials:sync', {
                detail: creds,
              })
            );
          }
          return creds;
        }
      } catch (err) {
        console.warn('[YaoxiAuth] 随认证中心下发凭据异常:', err);
      }
      return null;
    }

    parseJwtPayload(jwtToken) {
      if (!jwtToken || typeof jwtToken !== 'string') return {};
      try {
        const parts = jwtToken.split('.');
        if (parts.length >= 2) {
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const jsonStr = decodeURIComponent(escape(atob(base64)));
          return JSON.parse(jsonStr);
        }
      } catch (e) {
        try {
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          return JSON.parse(atob(base64));
        } catch (err) {}
      }
      return {};
    }
  }

  return YaoxiAuth;
});
