/** polyfill  */
import 'core-js/modules/es.symbol.async-iterator.js';

/**
 * @typedef {import('@gopeed/types').FileInfo } FileInfo 
 * @typedef {import('gopeed').Resource } OnResovleContext 
 * @typedef {import("@netdisk-sdk/cloud189-sdk").IAppToken} IAppToken
 * @typedef {import("@netdisk-sdk/cloud189-sdk").IAppSession} IAppSession
 * * @typedef {import("@netdisk-sdk/quarkuc-sdk").ICreateClientByType} ICreateClientByType
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IFile} IFile 
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IQuerySortParam} IQuerySortParam 
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IShareFile} IShareFile 
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IQueryShareParam}  IQueryShareParam
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IFidExtend} IFidExtend  
*/

/**
 * @typedef { (pdir_fid: IFidExtend) => AsyncGenerator<IShareFile, void, undefined> } FFileIter
 */

import { QuarkUCClient, getFileFid } from "@netdisk-sdk/quarkuc-sdk";
import { createWalkIter, createListIter } from '@netdisk-sdk/utils';
import merge from "lodash.merge";
import all from 'it-all';
import map from 'it-map';
import filter from 'it-filter';

const ShareType = '1'
const PersonType = '2'

gopeed.events.onResolve(async (ctx) => {
  try {
    const url = decodeURI(ctx.req.url)
    gopeed.logger.debug(`开始解析URL: ${url}`);
    /** @type {string[]} */
    const [, type] = url.match(/(uc|quark)\.cn/i) || []
    /** @type {[,?string]} */
    const [, pdir_fid = '0', folder_name] = url.match(/#\/list\/(?:share|all)(?:\/.*)?\/([a-z0-9]{32})(?:-(.*))?/i) || []
    /** @type {[,?string]} */
    const [, code] = url.match(/\/s\/([a-z0-9]*)/i) || []

    gopeed.logger.debug(`检测到网盘类型: ${type || '未知'}`);

    const client = createClient(type)

    // 处理分享
    if (code != null) {
      /** @type {[,?string]} */
      const [, pwd] = url.match(/(?:密码|pwd)\W+([a-z0-9]{4})/i) || []
      gopeed.logger.debug(`[${type}] 解析分享链接: code=${code}, pdir_fid=${pdir_fid}`);

      const { stoken, title } = await client.shareApi.token(code, pwd)
      gopeed.logger.debug(`[${type}] 获取分享stoken成功`);

      const filesIter = resolveWithShare(ctx, client, pdir_fid, { stoken, code }, getResolveOption())
      const files = await all(map(filter(filesIter, isFile), (file) => toGopeedFile(file, type, { stoken, code, pwd })))
      ctx.res = { name: title || '分享文件', range: true, files: files };
      gopeed.logger.debug(`[${type}] 分享链接解析成功，共找到 ${files.length} 个文件`);
      return
    }

    // 处理个人网盘
    if (url.includes('#/list/all')) {
      gopeed.logger.debug(`[${type}] 解析个人网盘: pdir_fid=${pdir_fid}, 文件夹名=${folder_name || '根目录'}`);

      const filesIter = resolveWithPerson(ctx, client, pdir_fid, getResolveOption())
      const files = await all(map(filter(filesIter, isFile), (file) => toGopeedFile(file, type)))
      ctx.res = { name: folder_name || '全部文件', range: true, files: files };
      gopeed.logger.debug(`[${type}] 个人网盘解析成功，共找到 ${files.length} 个文件`);
      return
    }
  } catch (error) {
    gopeed.logger.error(`文件解析失败: 错误=${error}, 堆栈=${error?.stack}}`)
  }
});

gopeed.events.onStart(async (ctx) => {
  const { req } = ctx.task.meta
  const labels = req.labels
  const downloadUrl = req.url
  gopeed.logger.debug(`任务开始，文件: ${labels.path}`);
  try {
    gopeed.logger.debug(`检查下载链接是否过期...`);
    if (await checkLinkExpire(downloadUrl, req.extra?.header)) {
      gopeed.logger.debug(`下载链接已过期或无效，正在获取新链接...`);
      const result = await parseDownloadLink(labels)
      if (result == null) throw '获取新下载链接失败，发生未知错误'

      req.url = result.link
      req.extra = merge(req.extra, {
        header: result.header
      })
      gopeed.logger.debug(`成功获取新的下载链接`);
    } else {
      gopeed.logger.debug(`下载链接仍然有效，继续下载`);
    }
  } catch (error) {
    gopeed.logger.error(`下载链接解析失败, 错误=${error}, 堆栈=${error?.stack}, labels=${JSON.stringify(labels)}`)
  }
})

gopeed.events.onError(async (ctx) => {
  gopeed.logger.error(`任务 ${ctx.task.id} 发生错误: ${ctx.error}`);
})

/**
 * @typedef {import('./types').IShareFileLabels} IShareFileLabels
 * @typedef {import('./types').IPersonFileLabels} IPersonFileLabels
 * @param {IShareFileLabels&IPersonFileLabels} labels  
 */
export const parseDownloadLink = async (labels) => {
  const {
    [gopeed.info.identity]: parseType,
    type, fid, share_fid_token, code, stoken, self_share
  } = labels

  gopeed.logger.debug(`开始解析下载链接, 类型=${parseType}, 文件ID=${fid}`);
  const client = createClient(type)

  const createLink = (link) => {
    const { cookie, ua, referer } = client.config
    return {
      link, header: {
        "Cookie": cookie,
        "Referer": referer,
        "User-Agent": ua,
      }
    }
  }

  /** 获取自己文件的下载链接 */
  const getSelf = async () => {
    gopeed.logger.debug(`正在获取个人文件的下载链接 (fid: ${fid})`);
    return await client.fsApi.download(fid);
  }
  /** 获取别人分享的下载链接 */
  const getOthersShare = async () => {
    gopeed.logger.debug(`开始转存他人分享的文件 (fid: ${fid}) 以获取下载链接`);
    const { task_id } = await client.shareApi.save(code, stoken, '0', [{ fid, share_fid_token }])
    gopeed.logger.debug(`转存任务已创建, task_id: ${task_id}, 等待任务完成...`);
    const result = await client.shareApi.saveTask(task_id, true)
    if (result.status != 2) { throw `转存分享失败: result: ${JSON.stringify(result)}` }
    gopeed.logger.debug(`文件转存成功`);

    const [file_fid] = result.save_as.save_as_top_fids;
    const down_result = await client.fsApi.download(file_fid);
    gopeed.logger.debug(`获取到转存后文件的下载链接，开始清理临时文件 (fid: ${file_fid})`);

    client.fsApi.delete([file_fid])
      .then(({ task_id }) => client.fsApi.task(task_id, true))
      .catch(err => gopeed.logger.error(`清理转存的临时文件失败: ${err}`))
    return down_result
  }

  if (parseType == PersonType || self_share) {
    if (self_share) gopeed.logger.debug("检测到这是自己的分享，直接按个人文件处理");
    const { download_url } = await getSelf()
    return createLink(download_url)
  }

  if (parseType == ShareType) {
    const { download_url } = await getOthersShare().catch(error => {
      if (error?.__info?.code == 41017) {
        gopeed.logger.warn("转存失败，错误码41017，这可能是您自己的分享。将尝试作为个人文件直接获取。");
        labels['self_share'] = true
        return getSelf()
      }
      return Promise.reject(error)
    })
    return createLink(download_url)
  }

  gopeed.logger.warn(`未知的解析类型: ${parseType}`);
  return null
}

/** * 检测下载地址是否过期
 * @param {string|URL} url
 */
const checkLinkExpire = async (url, headers = {}) => {
  try {
    const query = new URL(url).searchParams
    const expires = query.get('Expires')
    if (expires && Date.now() < new Date(parseInt(expires) * 1000)) {
      gopeed.logger.debug(`链接未到期，正在发送HEAD请求验证有效性...`);
      const { status } = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-0', ...headers } })
      const isExpired = status < 200 || status >= 400;
      if (isExpired) {
        gopeed.logger.debug(`HEAD请求失败 (status: ${status})，链接被视为无效`);
      } else {
        gopeed.logger.debug(`HEAD请求成功，链接有效`);
      }
      return isExpired;
    }
    gopeed.logger.debug(`链接已过物理有效期或无有效期信息`);
  } catch (error) {
    gopeed.logger.warn(`检查链接有效期时发生未知错误: ${error}`)
  }
  return true
}

/**
 * @param {IShareFile|IFile } file 
 * @param {'quark'|'uc'} type
 * @param {{ stoken:string, code:string, pwd:string }|undefined} shareLabels
 * @return { FileInfo }
 */
export const toGopeedFile = (file, type, shareLabels) => {
  /** @type {IShareFile&IFile} */
  const { file_name, path, size, fid, share_fid_token } = file
  return {
    range: true,
    name: file_name,
    path: path.split('/').slice(1, -1).join('/'),
    size,
    req: {
      url: `http://${type}/${fid}`, // 占位
      labels: {
        [gopeed.info.identity]: shareLabels != null ? ShareType : PersonType,
        type, path, fid,
        share_fid_token, ...shareLabels
      }
    }
  }
}

/** @param { IShareFile|IFile } file*/
export const isFile = (file) => {
  return file.file_type == 1
}

/**
 * 解析个人网盘
 * @param {OnResovleContext} ctx 
 * @param {QuarkUCClient} client
 * @param {string} pdir_fid 父目录id
 * @param {object} options
 * @param {number} options.deep 解析目录深度
 * @param {number} options.maxcount 最大数量
 */
export const resolveWithPerson = async function* (ctx, client, pdir_fid, options) {
  gopeed.logger.debug(`开始遍历个人网盘目录, pdir_fid: ${pdir_fid}`);
  const _size = 1000

  /** @param {IQuerySortParam} param */
  const sort = (param) => client.fsApi.sort(param)
  const listWalk = createWalkIter(createListIter(sort, {
    pageField: '_page',
    hasMore: (result) => result._count >= _size
  }), {
    ...options,
    getNextParam(file, param) {
      return isFile(file) ? null : { ...param, pdir_fid: getFileFid(file) }
    },
    transferFile(pfile, file) {
      return {
        path: `${pfile?.path ?? ''}/${file.file_name}`,
        ...file
      }
    },
  })
  yield* listWalk({ _size, pdir_fid })
}

/**
 * 解析分享
 * @param {OnResovleContext} ctx 
 * @param {QuarkUCClient} client
 * @param {string} pdir_fid 父目录id
 * @param {object} shareParam
 * @param {string} shareParam.stoken 提取密码
 * @param {string} shareParam.code 提取密码
 * @param {object} options
 * @param {number} options.deep 解析目录深度
 * @param {number} options.maxcount 最大数量
 */
export const resolveWithShare = async function* (ctx, client, pdir_fid, { stoken, code }, options) {
  gopeed.logger.debug(`开始遍历分享目录, pdir_fid: ${pdir_fid}`);
  const _size = 1000
  /** @param {IQueryShareParam} param */
  const detail = (param) => client.shareApi.detail(code, stoken, param)
  const listWalk = createWalkIter(createListIter(detail, {
    pageField: '_page',
    hasMore: (result) => result._count > 0
  }), {
    ...options,
    getNextParam(file, param) {
      return isFile(file) ? null : { ...param, pdir_fid: getFileFid(file) }
    },
    transferFile(pfile, file) {
      return {
        path: `${pfile?.path ?? ''}/${file.file_name}`,
        ...file
      }
    },
  })
  yield* listWalk({ _size, pdir_fid })
}

/** @param {'uc'|'quark'} type */
export const createClient = (type) => {
  gopeed.logger.debug(`正在为 '${type}' 创建客户端...`);
  const { identif: cookie, update } = getIdentif(`${type}_cookie`)

  return new QuarkUCClient({
    type,
    cookie,
    cookieUpdate: update
  })
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

/** * 自动处理setting与storage中的授权信息
 * @param {string} storeKey
 * @param {string} settingKey
 */
const getIdentif = (storeKey, settingKey = storeKey) => {
  const parseJSON = (v) => {
    try { return JSON.parse(v) } catch { return null }
  }

  const setIdentif = gopeed.settings[settingKey]
  const setUnique = String(setIdentif).hashCode()
  const [storeIdentif, storeUnique] = parseJSON(gopeed.storage.get(storeKey)) || []
  const update = (identif) => {
    gopeed.storage.set(storeKey, JSON.stringify([identif, setUnique]))
    gopeed.logger.debug(`Cookie已更新并存入storage: key=${storeKey}`);
    return identif
  }

  if (storeUnique == setUnique) {
    gopeed.logger.debug(`从storage加载有效的Cookie: key=${storeKey}`);
    return { identif: storeIdentif, unique: setUnique, update }
  }
  gopeed.logger.debug(`setting中的Cookie已更新，正在存入storage: key=${storeKey}`);
  return { identif: update(setIdentif), unique: setUnique, update }
}

String.prototype.hashCode = function () {
  var hash = 0, i = 0, len = this.length;
  while (i < len) {
    hash = ((hash << 5) - hash + this.charCodeAt(i++)) << 0;
  }
  return hash;
};

