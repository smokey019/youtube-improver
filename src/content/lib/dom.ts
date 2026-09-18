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

/**
 * Creates (or updates) a <style> tag scoped by `id`. Pass an empty string to disable it.
 *
 * The tag re-homes itself into <head> as soon as one exists. The content script runs at document_start, so
 * the first injection can land in an empty documentElement and end up ahead of YouTube's own stylesheets,
 * where it would lose cascade ties. Callers re-run on DOMContentLoaded and every navigation, so the move
 * happens on the next pass and then stays put.
 */
export function setInjectedCSS(id: string, css: string): void {
  let style = injectedStyles.get(id)
  if (!style) {
    style = document.createElement('style')
    style.id = `ytimprover-${id}`
    injectedStyles.set(id, style)
  }

  const parent: Node = document.head ?? document.documentElement
  if (style.parentNode !== parent) parent.appendChild(style)

  style.textContent = css
}

export function clearInjectedCSS(id: string): void {
  const style = injectedStyles.get(id)
  if (style) style.textContent = ''
}
