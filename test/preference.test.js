const test = require('node:test')
const assert = require('node:assert/strict')
require('../src/helper/preference')
const migratePreference = global.__MPLVR_HELPERS.migratePreference

const qualities = [
  {code: 'GQ', name: '高清', value: 150, orderIndex: 1},
  {code: 'CQ', name: '超清', value: 250, orderIndex: 2},
  {code: 'YH', name: '原画', value: 10000, orderIndex: 4}
]

test('有效的旧配置按 code 恢复', () => {
  const result = migratePreference(qualities, {code: 'CQ', name: '旧名称'}, 'YH')
  assert.equal(result.code, 'CQ')
})

test('code 失效时尝试 name/value，再回退默认配置', () => {
  assert.equal(migratePreference(qualities, {code: 'OLD', name: '高清'}, 'YH').code, 'GQ')
  assert.equal(migratePreference(qualities, {code: 'OLD', value: 10000}, 'YH').code, 'YH')
  assert.equal(migratePreference(qualities, {code: 'OLD'}, 'YH').code, 'YH')
})

test('没有默认配置时回退到最高优先级', () => {
  assert.equal(migratePreference(qualities, {code: 'OLD'}, null).code, 'YH')
})

test('空配置列表保持原值', () => {
  const saved = {code: 'GQ'}
  assert.equal(migratePreference([], saved, 'YH'), saved)
})
