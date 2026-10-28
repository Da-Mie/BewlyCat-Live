// copy with vscode

interface IdleDeadline {
  readonly didTimeout: boolean
  timeRemaining: () => number
}

interface IDisposable {
  dispose: () => void
}

/** 空闲时执行回调；不支持 requestIdleCallback 时回退 setTimeout。返回值可取消。 */

// eslint-disable-next-line import/no-mutable-exports
export let runWhenIdle: (callback: (idle: IdleDeadline) => void, timeout?: number) => IDisposable

declare function requestIdleCallback(callback: (args: IdleDeadline) => void, options?: { timeout: number }): number
declare function cancelIdleCallback(handle: number): void;

(function () {
  if (typeof requestIdleCallback !== 'function' || typeof cancelIdleCallback !== 'function') {
    runWhenIdle = (runner) => {
      let disposed = false
      setTimeout(() => {
        if (disposed)
          return
        const end = Date.now() + 15 // one frame at 64fps
        runner(Object.freeze({
          didTimeout: true,
          timeRemaining() {
            return Math.max(0, end - Date.now())
          },
        }))
      })
      return {
        dispose() {
          if (disposed)
            return
          disposed = true
        },
      }
    }
  }
  else {
    runWhenIdle = (runner, timeout?) => {
      const handle: number = requestIdleCallback(runner, typeof timeout === 'number' ? { timeout } : undefined)
      let disposed = false
      return {
        dispose() {
          if (disposed)
            return

          disposed = true
          cancelIdleCallback(handle)
        },
      }
    }
  }
})()

// 执行失败时不缓存，下次读取重试。
export class LazyValue<T> {
  private _value: T | undefined
  private _didRun = false

  constructor(
    private executor: () => T,
  ) {}

  get value(): T {
    if (!this._didRun) {
      this._value = this.executor()
      this._didRun = true
    }
    return this._value!
  }
}
