// app进程和renderer进程通信channel定义
const IpcChannel = {
  stopAllTasks: 'stopAllTasks',
  getDouyinRoomData: 'getDouyinRoomData',
  getDouyinRoomDataReply: 'getDouyinRoomDataReply',
  getDouyuSign: 'getDouyuSign',
  getDouyuSignReply: 'getDouyuSignReply',
  checkUpdate: 'checkUpdate',
  checkUpdateReply: 'checkUpdateReply',
  downloadUpdate: 'downloadUpdate',
  downloadUpdateProgress: 'downloadUpdateProgress',
  downloadUpdateReply: 'downloadUpdateReply',
  installUpdate: 'installUpdate',
  browserFetch: 'browserFetch',
  browserFetchReply: 'browserFetchReply'
}

export default IpcChannel
