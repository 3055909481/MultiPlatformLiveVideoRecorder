import axios from 'axios'
import {getGatewayExchangeServerPort, getGatewayToken} from '../../helper'

/**
 * 所有平台请求统一走主进程的本地代理：
 * 1. renderer 保持 webSecurity 开启；
 * 2. 代理负责携带自定义 UA/Cookie，并做目标地址校验；
 * 3. 代理返回统一信封，这里还原成 axios 风格的响应对象。
 */
async function exchange (config) {
  const res = await axios.request({
    url: `http://127.0.0.1:${getGatewayExchangeServerPort()}/gateway/exchange`,
    method: 'post',
    data: {config},
    headers: {
      'Content-Type': 'application/json',
      'X-MPLVR-Token': getGatewayToken()
    },
    timeout: 30000
  })
  const envelope = res.data || {}
  return {
    data: envelope.data,
    status: envelope.status,
    statusText: envelope.statusText,
    headers: envelope.headers || {},
    request: {responseURL: envelope.responseURL || ''},
    error: !!envelope.error
  }
}

export default {
  get: function (url, headers) {
    return exchange({method: 'get', url, headers})
  },
  post: function (url, data, headers) {
    return exchange({method: 'post', url, data, headers})
  },
  postExchange: function (exchangeData) {
    return exchange(exchangeData.config)
  },
  options: function (url, headers) {
    return exchange({method: 'get', url, headers})
  }
}
