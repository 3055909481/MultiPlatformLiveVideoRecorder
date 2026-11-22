'use strict'

const root = typeof window !== 'undefined' ? window : global
root.__MPLVR_HELPERS = root.__MPLVR_HELPERS || {}

/**
 * 只允许访问公网 http(s) 地址，避免本地代理被用于探测内网服务。
 */
root.__MPLVR_HELPERS.isSafeTargetUrl = function (rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch (e) {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost')) return false
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  return true
}
