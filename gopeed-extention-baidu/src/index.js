import 'core-js/modules/es.symbol.async-iterator.js';

/**
 * @typedef {import('@gopeed/types').FileInfo } FileInfo 
 * @typedef {import('gopeed').OnResovleContext } OnResovleContext 
 * @typedef {import('gopeed').OnStartContext } OnStartContext 
*/

/**
 * @typedef {import('@netdisk-sdk/baidu-sdk').IFile} IFile
 * @typedef {import('@netdisk-sdk/baidu-sdk').IShareParam} IShareParam
 * @typedef {import("@netdisk-sdk/baidu-sdk").ITransferShareParam} ITransferShareParam
 */

/**
 * @typedef {import('./types').IShareFileLabels} IShareFileLabels
 * @typedef {import('./types').IPersonFileLabels} IPersonFileLabels
 * @typedef {import("./types").IFileCommonLabels} IFileCommonLabels
 */

import { posix as PathUtil } from 'path';
import all from 'it-all';
import map from 'it-map';
import filter from "it-filter";
import merge from 'lodash.merge';

import { createWalkIter, createListIter, ObjectUtil } from "@netdisk-sdk/utils";
import { createAuthClient, BaiduClient, createOAuth2Fetch, decryptMd5, parseShareParam, isRootPath, getFileTime, decodeSceKey, ApiError, replaceUrl } from '@netdisk-sdk/baidu-sdk';
import { DuParser, parseQueryLink } from './duParser.js';

const defaultHeader = { 'user-agent': 'netdisk' }

gopeed.events.onResolve(async (ctx) => {
  try {
    const url = new URL(ctx.req.url);

    // 处理个人云
    if (url.pathname.startsWith("/disk/main") || url.pathname.startsWith("/wap/home")) {
      const [, , rawpath = "/"] = /(path|dir)=([^&]*)/.exec(url.hash) || []
      const path = decodeURIComponent(rawpath)
      const name = PathUtil.basename(path)
      const title = name || '全部文件'

      const filesIter = resolveWithPerson(ctx, path, getResolveOption())
      const files = await all(map(filter(filesIter, isFile), (file) => toGopeedFile(file, title)))
      ctx.res = {
        name: title,
        range: true,
        files
      }
      gopeed.logger.debug(`获取到文件数量 ${files.length}`)
      return
    }

    // 处理分享链接
    const shareInfo = parseShareParam(url)
    if (shareInfo != null) {
      // 解析链接中的地址
      const path = (() => {
        if (url.hash.startsWith('#/home/')) {
          const [, path] = url.hash.slice(7).split('/', 2).map(v => v && decodeURIComponent(v))
          return path
        } else if (url.hash.startsWith('#list/')) {
          const query = new URLSearchParams(url.hash.slice(6))
          const fullPath = query.get("path") ?? ''
          const rootPath = query.get("parentPath") ?? ''
          return PathUtil.join('/', PathUtil.relative(rootPath, fullPath))
        } else return '/'
      })()
      const { rootPath, name, shareTransfer } = await getShareRootPath(shareInfo)
      const fullPath = isRootPath(path) ? '/' : PathUtil.join('/', rootPath, path)
      const title = name || '分享文件'

      const filesIter = resolveWithShare(ctx, shareInfo, fullPath, getResolveOption())
      const files = await all(map(filter(filesIter, isFile), (file) => toGopeedFile(file, title, rootPath, { ...shareInfo, ...shareTransfer })))

      ctx.res = {
        name: title,
        range: true,
        files
      }
      gopeed.logger.debug(`${JSON.stringify(shareInfo)} 获取到文件数量 ${files.length}`)
      return
    }

    // 处理bdlink
    const filesInfo = DuParser.parse(parseQueryLink(url.hash))
    if (filesInfo?.length) {
      const files = filesInfo.map(file => {
        const { size, md5, path } = file
        const name = PathUtil.basename(path)
        const rootpath = PathUtil.join('/', PathUtil.dirname(path))
        const dir = PathUtil.relative('/', rootpath)
        return {
          name,
          path: dir,
          size: size,
          req: {
            extra: { header: {} },
            url: `https://pan.baidu.com/${md5}#${size}`,
            labels: {
              [gopeed.info.identity]: '0',
              path, size, md5
            }
          }
        }
      })
      ctx.res = {
        name: '秒链解析',
        range: true,
        files
      }
      gopeed.logger.debug(`获取到文件数量 ${files.length}`)
      return
    }
  } catch (error) {
    gopeed.logger.error(`文件解析失败: error: ${error},stack: ${error?.stack}}`)
  }
});

gopeed.events.onStart(async (ctx) => {
  const { req } = ctx.task.meta
  const labels = req.labels
  const downloadUrl = req.url
  try {
    if (await checkLinkExpire(downloadUrl)) {
      // 获取新的链接
      const result = await parseDownloadLink(labels)
      if (result == null) throw '未知错误'

      req.url = result.link
      req.extra = merge(req.extra, {
        header: result.header
      })
    }
  } catch (error) {
    throw `下载链接解析失败, error: ${error},stack: ${error?.stack}, labels: ${JSON.stringify(labels)}`
  }
})

gopeed.events.onError(async (ctx) => {

})

/**
 * 转换为资源文件类型
 * @param {IFile} file
 * @param {string|undefined} rootPath
 * @param {Pick<IShareFileLabels,'shareParam'|'shareTransfer'>|undefined} shareExtend
 * @returns { FileInfo }
 */
const toGopeedFile = (file, defaultPath = '已解析文件', rootPath = '', shareExtend) => {
  const md5 = decryptMd5(file.md5)
  const size = parseInt(file.size)
  const name = file.server_filename
  const path = PathUtil.join('/', PathUtil.relative(rootPath, file.path))
  const dir = PathUtil.relative('/', PathUtil.dirname(path))
  const { ctime, mtime } = getFileTime(file)
  return {
    name: name,
    path: dir || defaultPath,
    size: size,
    req: {
      extra: { header: {} },
      url: `https://pan.baidu.com/${md5}#${size}`,
      labels: {
        [gopeed.info.identity]: shareExtend ? '1' : '2',
        ...(shareExtend || {}),
        fid: file.fs_id,
        path,
        size, md5,
        mtime, ctime
      }
    }
  }
}

/** @param {IFile} file */
const isFile = (file) => file.isdir == 0

/**
 * 解析下载地址
 * @param { IShareFileLabels&IPersonFileLabels&IFileCommonLabels } labels
 */
const parseDownloadLink = async (labels) => {
  const { use_youth, refreshToken } = gopeed.settings
  const {
    [gopeed.info.identity]: type,
    shareid, from, sekey,
    path, fid,
    md5, size, ctime, mtime
  } = labels
  /** @type {ITransferShareParam} */
  const shareTransfer = { shareid, from, sekey }
  const filename = PathUtil.basename(path)
  const savepath = PathUtil.join('/gopeed_temp')
  const filepath = PathUtil.join(savepath, filename)

  const client = createClient()
  const autoClientApi = client[`fs${use_youth ? 'Youth' : ''}Api`]

  /** 
   * 获取文件下载地址
   * @param {Pick<IFile,'path'|'fs_id'>} file
   */
  const parseLink = async (file) => {
    const { info } = await autoClientApi.filemetas({ target: [file.path], dlink: 1 }, defaultHeader['user-agent'])
    const link = await client.redirectDlink(replaceUrl(info[0].dlink, use_youth), defaultHeader['user-agent'])
    return { link: link.toString(), header: defaultHeader }
  }

  // 处理秒传
  if (/[0-9a-z]{32}/i.test(md5) && filename != null && size != null) {
    const updateParam = { path: filepath, size, isdir: 0, block_list: [md5], rtype: 3, local_ctime: ctime, local_mtime: mtime }
    let file = null
    if (use_youth) {
      const { uploadid } = await autoClientApi.precreate(updateParam)
      file = await autoClientApi.create({ ...updateParam, uploadid })
    } else if (type == '0') {
      if (!refreshToken) throw '需要设置refreshToken'
      file = await client.fsOpenApi.create(updateParam)
    }
    if (file != null) {
      try { return await parseLink(file) } finally {
        // 删除文件
        autoClientApi.recycleDelete({ async: 0 }, file.fs_id).catch(err => {
          gopeed.logger.warn(`秒传文件：${file.path} 删除失败，错误：${err}`)
          autoClientApi.filemanager('delete', { filelist: [file.path] })
        })
      }
    }
  }

  // 解析分享文件
  if (type == '1') {
    // 部分账号Cookie登录时，文件操作需要 bdstoken
    if (typeof client.source == 'string') {
      const { bdstoken } = await client.fsApi.gettemplatevariable(['bdstoken']); client.agentApi.query({ bdstoken })
    }

    for (let flag = 0; flag < 2; flag++) {
      try {
        const { extra: { list } } = await client.fsShareApi.transfer(shareTransfer, savepath, fid)
        const file = { path: list[0].to, fs_id: list[0].to_fs_id }
        try { return await parseLink(file) } finally {
          // 删除文件(直接删除回收站文件)
          client.fsApi.recycleDelete({ async: 0 }, file.fs_id).catch(err => {
            // 删除回收站文件需要验证，仅删除文件
            client.fsApi.filemanager('delete', { filelist: [file.path] }).catch(err2 => {
              gopeed.logger.warn(`转存文件：${file.path} 删除失败，错误：${err} and ${err2}`)
            })
          })
        }
      } catch (error) {
        // transfer 无法自动创建文件夹
        if (flag == 0 && error instanceof ApiError) {
          if (error.info()?.['errno'] == 2) {
            gopeed.logger.warn(`临时文件夹: ${savepath} 不存在`)
            await client.fsApi.create({ path: savepath, isdir: 1, rtype: 1 })
            continue
          }
        }
        throw error
      }
    }
  }

  // 解析个人文件
  if (type == '2') {
    return await parseLink({ path, fs_id: fid })
  }
  return null
}

import dayjs from 'dayjs';
/** 
 * 检测下载地址是否过期
 * @param {string|URL} url
 */
const checkLinkExpire = async (url) => {
  try {
    const query = new URL(url).searchParams
    const [time, expires] = [query.get('time'), query.get('expires')]
    if (time && expires) {
      const [, ...exp] = expires.match('([0-9]+)([dh])')
      const expTime = dayjs.unix(time).add(...exp)
      if (dayjs().isBefore(expTime)) {
        const { status } = await fetch(url, { method: 'HEAD', headers: defaultHeader })
        return status < 200 || status >= 400
      }
    }
  } catch (error) {
    gopeed.logger.warn(`未知的错误 in checkLinkExpire: err is ${error}`)
  }
  return true
}

/**
 * 获取分享的根路径
 * @param {IShareParam} shareParam
 */
const getShareRootPath = async (shareParam) => {
  const client = createClient()
  const { list, title, seckey, uk, shareid } = await client.fsShareApi.wxlist({ ...shareParam, dir: '/', num: 0 })
  const name = PathUtil.basename(title)
  const rootPath = PathUtil.dirname(title)
  /** @type {ITransferShareParam} */
  const shareTransfer = { shareid, from: uk, sekey: decodeSceKey(seckey) }
  return { rootPath, name, shareTransfer }
}

/**
 * 解析分享文件
 * @param {OnResovleContext} ctx 
 * @param {IShareParam} shareParam
 * @param {string} path 文件夹路径
 * @param {object} options
 * @param {number} options.deep 解析目录深度
 * @param {number} options.maxcount 最大数量
 */
const resolveWithShare = async function* (ctx, shareParam, dir = '/', options = { deep: 0, maxcount: Infinity }) {
  const client = createClient()
  const num = 200
  const listWalk = createWalkIter(
    createListIter(ObjectUtil.bindObject(client.fsShareApi, 'wxlist'), {
      hasMore: (result) => result.has_more
    }),
    {
      getNextParam(file, param) {
        return file.isdir == 1 ? { ...param, dir: file.path } : null
      },
      ...options
    })

  yield* listWalk({ ...shareParam, dir, num, order: 'name' })
}

/**
 * 解析个人网盘文件
 * @param {OnResovleContext} ctx 
 * @param {string} path 文件夹路径
 * @param {object} options
 * @param {number} options.deep 解析目录深度
 * @param {number} options.maxcount 最大数量
 */
const resolveWithPerson = async function* (ctx, dir = '/', options = { deep: 0, maxcount: Infinity }) {
  const client = createClient()

  const num = 200
  const listWalk = createWalkIter(
    createListIter(ObjectUtil.bindObject(client.fsApi, 'list'), {
      hasMore: (result) => result.list?.length >= num
    }),
    {
      getNextParam(file, param) {
        return file.isdir == 1 ? { ...param, dir: file.path } : null
      },
      ...options
    })

  yield* listWalk({ dir, num })
}

const AUTH_KEY = "auth_token"
const createClient = () => {
  const { clientId, clientSecret, refreshToken, cookie, use_youth, devuid } = gopeed.settings
  if (refreshToken) {
    const authClient = createAuthClient(clientId, clientSecret)
    const getToken = async () => {
      const token = JSON.parse(gopeed.storage.get(AUTH_KEY) || '{}')
      // gopeed.logger.debug('getToken', JSON.stringify(token), getIdentity())

      if (token.identity == getIdentity()) {
        return token
      }
      const newToken = await authClient.refreshToken({ refreshToken })
      // gopeed.logger.debug('getNewToken', JSON.stringify(token), getIdentity())
      return newToken
    }
    const source = createOAuth2Fetch({
      client: authClient,
      getNewToken: getToken,
      getStoredToken: getToken,
      storeToken(token) {
        gopeed.storage.set(AUTH_KEY, JSON.stringify({ ...token, identity: getIdentity() }))
        // gopeed.logger.debug('storeToken', JSON.stringify(token), getIdentity())
      },
      scheduleRefresh: false
    })

    const client = new BaiduClient(source)
    if (use_youth && devuid) client.setDevuid(devuid)
    return client
  }

  if (/STOKEN=/.test(cookie) && /BDUSS=/.test(cookie)) {
    return new BaiduClient(cookie)
  }

  throw '登录信息无效, 请配置 Refresh Token 或 Cookie'
}

/** 获取当前登录特征 */
const getIdentity = () => {
  const { refreshToken, cookie } = gopeed.settings
  if (refreshToken) {
    return refreshToken?.hashCode()
  }
  return cookie?.hashCode()
}

/**
 * 获取最大文件数量和最大文件夹深度选项
 */
const getResolveOption = () => {
  let { max_file_count = 0, folder_depth = 0 } = gopeed.settings
  if (max_file_count <= 0) {
    max_file_count = Infinity
  }
  if (folder_depth < 0) {
    folder_depth = Infinity
  }
  return { deep: folder_depth, maxcount: max_file_count }
}

String.prototype.hashCode = function () {
  var hash = 0, i = 0, len = this.length;
  while (i < len) {
    hash = ((hash << 5) - hash + this.charCodeAt(i++)) << 0;
  }
  return hash;
};