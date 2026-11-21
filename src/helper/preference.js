'use strict'

/**
 * 旧任务里持久化的清晰度/线路是完整对象；平台配置升级后 code 可能失效。
 * 这里按 code/value/name 依次尝试恢复，失败则回退到默认配置。
 */
function migratePreference (options, saved, defaultCode) {
  if (!Array.isArray(options) || options.length === 0) return saved || null
  if (saved && typeof saved === 'object') {
    const candidates = [saved.code, saved.value, saved.name]
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null || candidate === '') continue
      const found = options.find(option => option.code === candidate || option.value === candidate || option.name === candidate)
      if (found) return found
    }
  }
  const byCode = options.find(option => option.code === defaultCode)
  if (byCode) return byCode
  return options.reduce((best, option) => ((option.orderIndex || 0) > (best.orderIndex || 0) ? option : best), options[0])
}

exports.migratePreference = migratePreference
