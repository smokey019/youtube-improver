export function waitForElement<T extends Element = Element>(
  selector: string,
  options: { root?: ParentNode; timeoutMs?: number } = {}
): Promise<T | null> {
  const { root = document, timeoutMs = 10000 } = options
  const existing = root.querySelector<T>(selector)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const el = root.querySelector<T>(selector)
      if (el) {
        observer.disconnect()
        clearTimeout(timer)
        resolve(el)
      }
    })
    observer.observe(root === document ? document.documentElement : (root as Node), {
      childList: true,
      subtree: true,
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeoutMs)
  })
}

const injectedStyles = new Map<string, HTMLStyleElement>()

/** Creates (or updates) a <style> tag scoped by `id`. Pass empty string to effectively disable it. */
export function setInjectedCSS(id: string, css: string): void {
  let style = injectedStyles.get(id)
  if (!style) {
    style = document.createElement('style')
    style.id = `ytimprover-${id}`
    document.documentElement.appendChild(style)
    injectedStyles.set(id, style)
  }
  style.textContent = css
}

export function clearInjectedCSS(id: string): void {
  setInjectedCSS(id, '')
}
