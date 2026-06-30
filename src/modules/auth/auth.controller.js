import jwt from 'jsonwebtoken';
import * as authService from './auth.service.js';
import { success } from '../../utils/response.js';
import { env } from '../../config/env.js';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth',
};

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
}

export async function login(req, res, next) {
  try {
    const ip = req.ip || req.connection?.remoteAddress;
    const result = await authService.login(req.body, ip, req.get('user-agent'));
    setRefreshCookie(res, result.refreshToken);
    return success(res, {
      accessToken: result.accessToken,
      user: result.user,
    }, 'Login successful');
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ success: false, message: 'No refresh token' });

    const result = await authService.refresh(token);
    setRefreshCookie(res, result.refreshToken);
    return success(res, { accessToken: result.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let jti, exp;
    if (authHeader?.startsWith('Bearer ')) {
      const decoded = jwt.decode(authHeader.slice(7));
      jti = decoded?.jti;
      exp = decoded?.exp;
    }
    await authService.logout(req.user.id, jti, exp);
    clearRefreshCookie(res);
    return success(res, null, 'Logged out');
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await authService.getMe(req.user.id);
    return success(res, user);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    await authService.changePassword(
      req.user.id,
      req.body.currentPassword,
      req.body.newPassword
    );
    clearRefreshCookie(res);
    return success(res, null, 'Password changed. Please login again.');
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const result = await authService.forgotPassword(req.body.email);
    return success(res, null, result.message);
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    await authService.resetPassword(req.body.email, req.body.otp, req.body.newPassword);
    return success(res, null, 'Password reset successful');
  } catch (err) {
    next(err);
  }
}
