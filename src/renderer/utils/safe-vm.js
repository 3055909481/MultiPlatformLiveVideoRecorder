import vm from 'vm'

/**
 * 替代已弃用且存在沙箱逃逸漏洞的 vm2。
 * 只提供运行远端加签函数所需的最小全局对象，并禁用动态代码生成与超时保护。
 * 注意：这仍然是运行远端 JS，不能视为绝对安全边界；只应访问可信的官方端点。
 */
export function runIsolated (code, sandbox, timeout = 3000) {
  const safeGlobals = {
    ...sandbox,
    console: {log () {}, warn () {}, error () {}},
    eval: undefined,
    Function: undefined,
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    global: undefined
  }
  const context = vm.createContext(safeGlobals, {
    codeGeneration: {strings: false, wasm: false}
  })
  return vm.runInContext(code, context, {timeout, displayErrors: true})
}

export default runIsolated
