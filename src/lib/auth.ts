// src/lib/auth.ts
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from './firebase';
import { supabase } from './supabase';

export type Role = 'admin' | 'manager' | 'cashier';
export interface AuthUser { login: string; role: Role; loggedInAt: number; }

const STORAGE_KEY = 'kebab-pos-auth';

/**
 * Определяем роль по email/логину.
 * Логика прежняя (по подстроке), но теперь login — это email из Firebase.
 * Если хотите надёжнее — храните роль в Firebase Custom Claims и читайте
 * из `firebaseUser.getIdTokenResult()`.
 */
export function detectRole(login: string): Role {
  const l = login.trim().toLowerCase();
  // Разработчик видит всё (как admin): меню, статистика, все роли
  if (isDeveloper(l)) return 'admin';
  if (l.includes('admin')) return 'admin';
  if (l.includes('manager')) return 'manager';
  return 'cashier';
}

/**
 * ✅ Вход через Firebase Authentication (email + password).
 * Асинхронный — вызывающий код должен использовать `await`.
 */
export async function login(
  loginValue: string,
  password: string
): Promise<AuthUser> {
  const loginStr = loginValue.trim();
  if (!loginStr) throw new Error('Введите email');
  if (!password || password.length < 6) {
    throw new Error('Пароль минимум 6 символов');
  }

  try {
    // 1. Реальная проверка пары email/пароль в Firebase
    const credential = await signInWithEmailAndPassword(
      auth,
      loginStr,
      password
    );
    const firebaseUser = credential.user;

    // 2. Формируем локального пользователя для UI
    const email = firebaseUser.email ?? loginStr;
    const user: AuthUser = {
      login: email,
      role: detectRole(email),
      loggedInAt: Date.now(),
    };

    // 3. Разработчик: тот же email/пароль для Supabase (нужен для DELETE по RLS).
    if (isDeveloper(email)) {
      const { error: sbErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (sbErr) {
        console.warn('[auth] Supabase sign-in (developer) failed:', sbErr.message);
      } else {
        console.info('[auth] Supabase sign-in OK (роль authenticated):', email);
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return user;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential'
    ) {
      throw new Error('Неверный email или пароль');
    }
    if (code === 'auth/invalid-email') {
      throw new Error('Некорректный email');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Слишком много попыток. Попробуйте позже.');
    }
    if (code === 'auth/network-request-failed') {
      throw new Error('Нет сети. Проверьте подключение.');
    }
    throw new Error(
      (error as { message?: string })?.message ?? 'Ошибка входа'
    );
  }
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.login || !parsed?.role) return null;
    // сохранённая ранее сессия разработчика тоже получает полный доступ
    if (isDeveloper(parsed.login)) parsed.role = 'admin';
    return parsed;
  } catch {
    return null;
  }
}

/**
 * ✅ Выход: завершает сессию Firebase + чистит localStorage.
 * Асинхронный — вызывающий код должен использовать `await`.
 */
export async function logout(): Promise<void> {
  try {
    await supabase.auth.signOut();
    await firebaseSignOut(auth);
  } catch (e) {
    console.warn('[auth] Firebase signOut failed:', e);
  }
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Режим разработчика: последние три буквы логина перед @ — «pro»
 * (например kebabpospro@wago.uz). Роль (admin / manager / cashier)
 * от этого не меняется — открывается только кнопка разработчика.
 * ВАЖНО: это проверка в интерфейсе. Настоящую защиту удаления данных
 * нужно держать в правилах Supabase (RLS) и Firebase.
 */
export function isDeveloper(login: string | null | undefined): boolean {
  if (!login) return false;
  const local = login.trim().toLowerCase().split('@')[0] ?? '';
  return local.endsWith('pro');
}

export function canSeeStatistics(role: Role): boolean {
  return role === 'admin';
}

export function canEditMenu(role: Role): boolean {
  return role === 'admin';
}

export function allowedRoles(
  role: Role
): Array<'cashier' | 'queue' | 'kitchen' | 'manager'> {
  if (role === 'admin') return ['cashier', 'queue', 'kitchen', 'manager'];
  if (role === 'manager') return ['cashier', 'queue', 'kitchen', 'manager'];
  return ['cashier', 'queue', 'kitchen'];
}
