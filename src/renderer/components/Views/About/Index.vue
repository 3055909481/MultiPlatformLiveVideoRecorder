<template>
  <common-page>
    <h1 slot="header">{{$route.meta.title}}</h1>
    <template slot="main">
      <el-form label-width="110px">
        <el-form-item label="作者：">
          ZuoBro
        </el-form-item>
        <el-form-item label="Github：">
          <s-link href="https://github.com/zbfzn"></s-link>
        </el-form-item>
        <el-form-item label="当前版本：">
          {{currentVersion}}
        </el-form-item>
        <el-form-item label="检查更新：">
          <el-button type="primary" size="mini" :loading="checking" @click="checkUpdate">检查更新</el-button>
          <span v-if="updateInfo && !updateInfo.hasUpdate && checked" style="margin-left:12px;color:#67c23a">已是最新版本</span>
        </el-form-item>
      </el-form>

      <el-alert
          v-if="updateInfo && updateInfo.hasUpdate"
          :title="`发现新版本 ${updateInfo.latestVersion}`"
          type="success"
          show-icon
          style="margin:10px 0">
        <template slot="default">
          <div v-if="updateInfo.releaseNotes" style="max-height:160px;overflow:auto;white-space:pre-wrap;margin-bottom:10px">{{updateInfo.releaseNotes}}</div>
          <div v-if="updateInfo.assetName" style="color:#909399;margin-bottom:10px">安装包：{{updateInfo.assetName}}（{{formatSize(updateInfo.assetSize)}}）</div>
          <el-button type="primary" size="mini" v-if="!downloadedPath" :loading="downloading" @click="downloadUpdate">
            {{downloading ? `下载中 ${downloadPercent}%` : '下载并安装'}}
          </el-button>
          <el-button type="success" size="mini" v-else @click="installUpdate">立即安装</el-button>
          <el-button type="text" size="mini" @click="openReleasePage">查看发布页</el-button>
        </template>
      </el-alert>

      <el-alert
          v-if="checkError"
          :title="checkError"
          type="error"
          show-icon
          style="margin:10px 0">
      </el-alert>
    </template>
  </common-page>
</template>

<script>
import CommonPage from '../../CommonPage'
import SLink from '../../SLink'
import IpcChannel from '../../../../helper/IpcChannel'
import ipcRendererUtil from '../../../../helper/ipcRendererUtil'
import {remote, shell} from 'electron'

export default {
  name: 'Index',
  components: {SLink, CommonPage},
  data () {
    return {
      currentVersion: '',
      checking: false,
      checked: false,
      downloading: false,
      downloadPercent: 0,
      downloadedPath: null,
      updateInfo: null,
      checkError: ''
    }
  },
  mounted () {
    this.currentVersion = remote.app.getVersion()
    ipcRendererUtil.on(IpcChannel.checkUpdateReply, this.onCheckUpdateReply)
    ipcRendererUtil.on(IpcChannel.downloadUpdateProgress, this.onDownloadProgress)
    ipcRendererUtil.on(IpcChannel.downloadUpdateReply, this.onDownloadReply)
    this.checkUpdate()
  },
  beforeDestroy () {
    ipcRendererUtil.removeListener(IpcChannel.checkUpdateReply, this.onCheckUpdateReply)
    ipcRendererUtil.removeListener(IpcChannel.downloadUpdateProgress, this.onDownloadProgress)
    ipcRendererUtil.removeListener(IpcChannel.downloadUpdateReply, this.onDownloadReply)
  },
  methods: {
    checkUpdate () {
      this.checking = true
      this.checked = false
      this.checkError = ''
      ipcRendererUtil.sendToMain(IpcChannel.checkUpdate)
    },
    onCheckUpdateReply (event, success, data) {
      this.checking = false
      this.checked = true
      if (!success) {
        this.checkError = '检查更新失败：' + (data && data.message ? data.message : '未知错误')
        return
      }
      this.updateInfo = data
    },
    downloadUpdate () {
      if (!this.updateInfo || !this.updateInfo.downloadUrl) return
      this.downloading = true
      this.downloadPercent = 0
      ipcRendererUtil.sendToMain(IpcChannel.downloadUpdate, this.updateInfo.downloadUrl, this.updateInfo.assetName)
    },
    onDownloadProgress (event, percent) {
      this.downloadPercent = percent
    },
    onDownloadReply (event, success, data) {
      this.downloading = false
      if (!success) {
        this.checkError = '下载更新失败：' + (data && data.message ? data.message : '未知错误')
        return
      }
      this.downloadedPath = data
      this.$message.success('下载完成，点击「立即安装」开始更新')
    },
    installUpdate () {
      if (!this.downloadedPath) return
      ipcRendererUtil.sendToMain(IpcChannel.installUpdate, this.downloadedPath)
    },
    openReleasePage () {
      if (this.updateInfo && this.updateInfo.releaseUrl) {
        shell.openExternal(this.updateInfo.releaseUrl)
      }
    },
    formatSize (bytes) {
      if (!bytes) return ''
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
      return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }
  }
}
</script>

<style scoped>
</style>
