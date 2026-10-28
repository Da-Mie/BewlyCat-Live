export enum LoginStatus {
  LoggedIn = 'logged-in',
  LoggedOut = 'logged-out',
  TransientError = 'transient-error',
}

export type LoginCheckResult<T>
  = | { status: LoginStatus.LoggedIn, data: T }
    | { status: LoginStatus.LoggedOut }
    | { status: LoginStatus.TransientError }

export type NavChecker<T> = () => Promise<{ code: number, data?: T }>

/** 以非 HttpOnly 的 DedeUserID 作为本地登录态依据。 */
export function parseDedeUserID(cookieString: string): number | undefined {
  const match = cookieString.match(/(?:^|;\s*)DedeUserID=(\d+)/)
  if (!match)
    return undefined

  const mid = Number(match[1])
  return mid > 0 ? mid : undefined
}

/** 仅 -101 视为登出；网络、风控和限流失败不改变登录态。 */
export async function checkLoginStatus<T>(check: NavChecker<T>): Promise<LoginCheckResult<T>> {
  try {
    const res = await check()

    if (res?.code === 0)
      return { status: LoginStatus.LoggedIn, data: res.data as T }

    if (res?.code === -101)
      return { status: LoginStatus.LoggedOut }

    return { status: LoginStatus.TransientError }
  }
  catch {
    return { status: LoginStatus.TransientError }
  }
}
