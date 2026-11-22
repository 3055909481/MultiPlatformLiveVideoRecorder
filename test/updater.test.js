const test = require('node:test')
const assert = require('node:assert/strict')

// 直接复制纯函数逻辑验证（避免 electron 依赖）
function parseVersion (version) {
  if (!version) return [0, 0, 0, 0]
  const cleaned = String(version).replace(/^v/i, '')
  const numbers = cleaned
    .split(/[.-]/)
    .filter(part => /^\d+$/.test(part))
    .map(part => parseInt(part, 10))
  while (numbers.length < 4) numbers.push(0)
  return numbers.slice(0, 4)
}

function isNewer (remote, local) {
  const r = parseVersion(remote)
  const l = parseVersion(local)
  for (let i = 0; i < r.length; i++) {
    if (r[i] > l[i]) return true
    if (r[i] < l[i]) return false
  }
  return false
}

test('解析带 fork 后缀的版本号', () => {
  assert.deepEqual(parseVersion('v1.2.6-fork.0'), [1, 2, 6, 0])
  assert.deepEqual(parseVersion('1.2.5-fork.1'), [1, 2, 5, 1])
})

test('正确判断新版本', () => {
  assert.equal(isNewer('v1.2.7-fork.0', '1.2.6-fork.0'), true)
  assert.equal(isNewer('v1.3.0-fork.0', '1.2.6-fork.0'), true)
  assert.equal(isNewer('v1.2.6-fork.1', '1.2.6-fork.0'), true)
})

test('相同版本或旧版本不提示更新', () => {
  assert.equal(isNewer('v1.2.6-fork.0', '1.2.6-fork.0'), false)
  assert.equal(isNewer('v1.2.5-fork.0', '1.2.6-fork.0'), false)
})
