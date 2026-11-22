import Vue from 'vue'
import axios from 'axios'

import ElementUI from 'element-ui'
import 'element-ui/lib/theme-chalk/index.css'

import App from './App'
import router from './router'

import dbs from './db'
import Global from './global'

// 引入iconfont图标
import '../../static/styles/iconfont.css'
import manager from './manager'

if (!process.env.IS_WEB) Vue.use(require('vue-electron'))
Vue.use(ElementUI)

Vue.http = Vue.prototype.$http = axios
// 数据库组件
Vue.prototype.$dbs = dbs
Vue.config.productionTip = false

// 启动失败时直接显示错误，避免只留下白屏
function showFatalError (error) {
  const message = error && error.stack ? error.stack : String(error)
  console.error('renderer init failed:', message)
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#fff;color:#b00;padding:24px;font:13px Consolas,monospace;white-space:pre-wrap;overflow:auto'
  container.textContent = '应用启动失败：\n\n' + message
  document.body.appendChild(container)
}

// 全局设置
try {
  Global.init()
} catch (error) {
  showFatalError(error)
  throw error
}

// 全局唯一
Vue.use(manager)

/* eslint-disable no-new */
let vm = new Vue({
  components: { App },
  router,
  template: '<App/>'
}).$mount('#app')

// 增加路由跳转函数
Vue.prototype.$routeTo = (path, name, params) => {
  vm.$router.push({
    path: path,
    name: name,
    params: {
      fromPath: vm.$route.fullPath,
      fromName: vm.$route.name,
      ...params
    }
  })
}
// 从当前路由获取上一路由信息并返回，没有则不返回
Vue.prototype.$routeBack = (backRoute, params) => {
  if (!backRoute.params || !backRoute.params.fromPath || !backRoute.params.fromName) {
    return
  }
  vm.$router.push({
    path: backRoute.params.fromPath,
    name: backRoute.params.fromName,
    params: params
  })
}
