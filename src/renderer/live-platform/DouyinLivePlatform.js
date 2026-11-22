import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'
import IpcChannel from '../../helper/IpcChannel'
import ipcRendererUtil from '../../helper/ipcRendererUtil'
import '../../helper/douyin-sign'

const douyinHelpers = () => (typeof window !== 'undefined' ? window.__MPLVR_HELPERS : global.__MPLVR_HELPERS)

function getRoomDataFromWindow (liveUrl) {
  return new Promise((resolve, reject) => {
    const listener = (event, url_, success, data) => {
      if (liveUrl !== url_) return
      ipcRendererUtil.removeListener(IpcChannel.getDouyinRoomDataReply, listener)
      if (success) resolve(data)
      else reject(new Error('获取直播流信息失败'))
    }
    ipcRendererUtil.on(IpcChannel.getDouyinRoomDataReply, listener)
    ipcRendererUtil.sendToMain(IpcChannel.getDouyinRoomData, liveUrl)
  })
}

function parseUserPage (html) {
  const webRid = /"web_rid"\s*:\s*"(\d+)"/.exec(html) || /web_rid[\\"=:]*(\d+)/.exec(html)
  const nickname = /"nickname"\s*:\s*"([^"\\]+)"/.exec(html) || /<title[^>]*>([^<]+)的主页/.exec(html)
  const douId = /抖音号[:：](?:<!-- -->)?\s*([^<\s]+)/.exec(html)
  const roomId = /"id_str"\s*:\s*"(\d+)"/.exec(html)
  const title = /"title"\s*:\s*"([^"\\]+)"/.exec(html)
  return {
    webRid: webRid ? webRid[1] : null,
    nickname: nickname ? nickname[1] : '',
    douId: douId ? douId[1] : '',
    roomId: roomId ? roomId[1] : null,
    title: title ? title[1] : ''
  }
}

class DouyinLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.httpHeaders = {
      'User-Agent': douyinHelpers().DOUYIN_UA,
      Referer: 'https://www.douyin.com/',
      Cookie: douyinHelpers().DOUYIN_TTWID,
      Accept: 'application/json'
    }
  }

  getUserUrl (id) {
    return `https://www.douyin.com/user/${id}?previous_page=app_code_link`
  }

  getLiveUrl (webRid) {
    return `https://live.douyin.com/${webRid}`
  }

  /**
   * 通过 webcast/room/web/enter 接口 + a_bogus 签名拿房间数据（无需验证码）
   */
  async fetchRoomByApi (webRid) {
    const params = {
      aid: '6383',
      app_name: 'douyin_web',
      live_id: '1',
      device_platform: 'web',
      language: 'zh-CN',
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Chrome',
      browser_version: '125.0.0.0',
      web_rid: webRid,
      msToken: ''
    }
    let url = 'https://live.douyin.com/webcast/room/web/enter/?' +
      Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')
    url = douyinHelpers().douyinSignUrl(url)
    const res = await HttpUtil.get(url, Object.assign({}, this.httpHeaders, {Referer: `https://live.douyin.com/${webRid}`}))
    const body = res.data
    if (!body || !body.data || !body.data.data || !body.data.data[0]) return null
    const room = body.data.data[0]
    return {
      nickname: (room.owner && room.owner.nickname) || '',
      title: room.title || '',
      status: room.status,
      idStr: room.id_str || null,
      secUid: room.owner && room.owner.sec_uid ? room.owner.sec_uid : (body.data.user && body.data.user.sec_uid) || null,
      streamMap: room.stream_url && room.stream_url.flv_pull_url ? room.stream_url.flv_pull_url : {}
    }
  }

  /**
   * 隐藏窗口兜底（页面结构变化/接口失效时）
   */
  async readLiveRoomFromWindow (webRid) {
    const streamDataStr = await getRoomDataFromWindow(this.getLiveUrl(webRid))
    const data = JSON.parse(streamDataStr) || {}
    return {
      streamMap: data.streams || data,
      nickname: data.nickname || ''
    }
  }

  async getUserInfo (idOrUrl) {
    // 直播间链接：https://live.douyin.com/{webRid}
    const liveMatch = /https?:\/\/live\.douyin\.com\/(\d+)/.exec(idOrUrl)
    if (liveMatch) {
      const webRid = liveMatch[1]
      let nickname = ''
      try {
        const room = await this.fetchRoomByApi(webRid)
        if (room) nickname = room.nickname || ''
      } catch (e) {
        // 接口失败时用 webRid 占位
      }
      return {
        id: webRid,
        idShow: webRid,
        name: nickname || webRid,
        webRid: webRid,
        roomId: null
      }
    }

    let id = null
    try {
      id = new RegExp('(?:/user/|sec_uid=)([^/&?]*)(?:$|\\?|&)', 'g').exec(idOrUrl)[1]
    } catch (e) {
      // 需要跟随重定向获取 sec_uid
    }
    if (!id) {
      const res = await HttpUtil.post(idOrUrl, null, this.httpHeaders)
      const found = new RegExp('(?:/user/|sec_uid=)([^/&?]*)(?:$|\\?|&)', 'g').exec(res.request.responseURL || '')
      if (found) id = found[1]
    }
    if (!id) throw new Error('无法解析抖音用户 ID')
    const res = await HttpUtil.post(this.getUserUrl(id), null, this.httpHeaders)
    const info = parseUserPage(res.data)
    return {
      id,
      idShow: info.douId || id,
      name: info.nickname || id,
      webRid: info.webRid,
      roomId: info.roomId
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    let webRid = user.webRid || null
    let pageInfo = {title: '', roomId: null, webRid: null}
    if (!webRid) {
      const userRes = await HttpUtil.post(this.getUserUrl(user.id), null, this.httpHeaders)
      pageInfo = parseUserPage(userRes.data)
      webRid = pageInfo.webRid
    }
    if (!webRid && !user.roomId) return null

    let streamMap = {}
    let liveNickname = ''
    let appRoomId = pageInfo.roomId || user.roomId
    let roomTitle = ''

    // 主路径：签名 HTTP 接口
    if (webRid) {
      try {
        const room = await this.fetchRoomByApi(webRid)
        if (room) {
          streamMap = room.streamMap
          liveNickname = room.nickname
          roomTitle = room.title
          if (room.idStr) appRoomId = room.idStr
        }
      } catch (e) {
        // 继续兜底
      }
    }

    // 兜底1：隐藏窗口
    if (Object.keys(streamMap).length === 0 && webRid) {
      try {
        const data = await this.readLiveRoomFromWindow(webRid)
        streamMap = data.streamMap
        liveNickname = liveNickname || data.nickname
      } catch (e) {
        // 继续兜底
      }
    }

    // 兜底2：旧版 app reflow 接口
    if (Object.keys(streamMap).length === 0 && appRoomId) {
      try {
        const res = await HttpUtil.postExchange({
          config: {
            url: `https://webcast.amemv.com/webcast/room/reflow/info/?verifyFp=&type_id=0&live_id=1&room_id=${appRoomId}&sec_user_id=&version_code=99.99.99&app_id=1128`,
            method: 'get',
            headers: {
              'User-Agent': this.phoneUserAgent,
              Referer: `https://webcast.amemv.com/webcast/reflow/${appRoomId}`
            }
          }
        })
        const room = res.data && res.data.data && res.data.data.room
        if (room && room.status === 2 && room.stream_url && room.stream_url.flv_pull_url) {
          streamMap = room.stream_url.flv_pull_url
          appRoomId = room.id_str || appRoomId
        }
      } catch (e) {
        // 继续走错误提示
      }
    }

    if (Object.keys(streamMap).length === 0) {
      throw new Error('抖音直播流获取失败，可尝试在弹出窗口中手动通过验证')
    }

    const qualityKeys = Object.keys(streamMap)
    const realQuality = DouyinLivePlatform.getPreference('value', 'orderIndex', DouyinLivePlatform.defaultConfig.qualities, qualityKeys, preferenceQuality.value)
    if (!realQuality) throw new Error('无可用清晰度')
    const streamUrl = streamMap[realQuality.value]
    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${douyinHelpers().DOUYIN_UA}\r\nReferer: https://live.douyin.com/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy',
        '-flvflags': 'add_keyframe_index'
      },
      title: roomTitle || pageInfo.title || liveNickname || user.name,
      quality: realQuality,
      channel: preferenceChannel,
      roomId: appRoomId
    }
  }
}

DouyinLivePlatform.getUserRoomOrHomeUrl = function (user) {
  if (user.webRid) return `https://live.douyin.com/${user.webRid}`
  return 'https://www.douyin.com/user/' + user.id
}

DouyinLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/www\.douyin\.com\/user\/.*/.test(url) ||
    /https?:\/\/live\.douyin\.com\/\d+/.test(url)
}

DouyinLivePlatform.platformInfo = {
  code: 'douyin',
  name: '抖音',
  website: 'https://www.douyin.com'
}
DouyinLivePlatform.defaultConfig = {
  qualities: [
    {code: 'BQ', name: '标清', value: 'SD1', orderIndex: 1},
    {code: 'GQ', name: '高清', value: 'SD2', orderIndex: 2},
    {code: 'CQ', name: '超清', value: 'HD1', orderIndex: 3},
    {code: 'LG', name: '蓝光(原画)', value: 'FULL_HD1', orderIndex: 4}
  ],
  channels: [
    {code: 'DEFAULT', name: '线路1', value: null, orderIndex: 1}
  ],
  defaultQualityCode: 'LG',
  defaultChannelCode: 'DEFAULT',
  idPlaceholder: '请输入抖音直播间地址或用户主页',
  dynamicRoomId: true
}

export default DouyinLivePlatform
