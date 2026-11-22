const test = require('node:test')
const assert = require('node:assert/strict')

// 复制 record-manager 的退避算法做纯逻辑验证
function computeReconnectBackoff (state, recordId, durationMs, now) {
  const MIN_DURATION = 2 * 60 * 1000
  const BASE = 30 * 1000
  const MAX = 5 * 60 * 1000
  let info = state[recordId] || {failures: 0, lastFailTime: 0}
  if (now - info.lastFailTime > 10 * 60 * 1000) info.failures = 0
  if (durationMs >= MIN_DURATION) {
    info.failures = 0
  } else {
    info.failures += 1
  }
  info.lastFailTime = now
  state[recordId] = info
  return info.failures === 0 ? BASE : Math.min(BASE * info.failures, MAX)
}

test('偶发长时录制中断只做基础退避并重置计数', () => {
  const state = {}
  const now = 1000000
  const b = computeReconnectBackoff(state, 'r1', 10 * 60 * 1000, now)
  assert.equal(b, 30000)
  assert.equal(state.r1.failures, 0)
})

test('连续短时中断退避逐步增大', () => {
  const state = {}
  let now = 1000000
  assert.equal(computeReconnectBackoff(state, 'r2', 5000, now), 30000) // 第1次
  now += 40000
  assert.equal(computeReconnectBackoff(state, 'r2', 5000, now), 60000) // 第2次
  now += 70000
  assert.equal(computeReconnectBackoff(state, 'r2', 5000, now), 90000) // 第3次
})

test('退避有5分钟上限', () => {
  const state = {}
  let now = 1000000
  for (let i = 0; i < 20; i++) {
    computeReconnectBackoff(state, 'r3', 1000, now)
    now += 30000
  }
  assert.equal(computeReconnectBackoff(state, 'r3', 1000, now), 300000)
})

test('间隔很久后重新中断会重置计数', () => {
  const state = {}
  let now = 1000000
  computeReconnectBackoff(state, 'r4', 1000, now)
  assert.equal(state.r4.failures, 1)
  now += 11 * 60 * 1000 // 超过10分钟
  computeReconnectBackoff(state, 'r4', 1000, now)
  assert.equal(state.r4.failures, 1) // 重置后重新计为1
})
