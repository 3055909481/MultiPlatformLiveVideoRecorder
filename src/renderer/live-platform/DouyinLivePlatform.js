import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'
import IpcChannel from '../../helper/IpcChannel'
import ipcRendererUtil from '../../helper/ipcRendererUtil'

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
      'User-Agent': this.pcUserAgent,
      Referer: 'https://www.douyin.com/'
    }
  }

  getUserUrl (id) {
    return `https://www.douyin.com/user/${id}?previous_page=app_code_link`
  }

  async getUserInfo (idOrUrl) {
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
      roomId: info.roomId
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const userRes = await HttpUtil.post(this.getUserUrl(user.id), null, this.httpHeaders)
    const pageInfo = parseUserPage(userRes.data)
    if (!pageInfo.webRid && !user.roomId) {
      // 没有 web_rid 也没有历史 app 房间号，认为未开播
      return null
    }

    let streamMap = {}
    let appRoomId = pageInfo.roomId || user.roomId
    if (pageInfo.webRid) {
      const liveUrl = `https://live.douyin.com/${pageInfo.webRid}?enter_from_merge=web_others_homepage&enter_method=web_live_btn&room_id=`
      try {
        const streamDataStr = await getRoomDataFromWindow(liveUrl)
        streamMap = JSON.parse(streamDataStr) || {}
      } catch (e) {
        streamMap = {}
      }
    }

    // 隐藏窗口抓不到时，尝试旧版 app 接口（语音直播/页面结构变化兜底）
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
        // 继续走下面的错误提示
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
        '-headers': `User-Agent: ${this.pcUserAgent}\r\nReferer: https://live.douyin.com/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy',
        '-flvflags': 'add_keyframe_index'
      },
      title: pageInfo.title || user.name,
      quality: realQuality,
      channel: preferenceChannel,
      roomId: appRoomId
    }
  }
}

DouyinLivePlatform.getUserRoomOrHomeUrl = function (user) {
  return 'https://www.douyin.com/user/' + user.id
}

DouyinLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/www\.douyin\.com\/user\/.*/.test(url)
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
  idPlaceholder: '请输入抖音用户主页地址或sec_uid',
  dynamicRoomId: true
}

export default DouyinLivePlatform
