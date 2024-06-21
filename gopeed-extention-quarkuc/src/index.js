/** polyfill  */
import 'fastestsmallesttextencoderdecoder';

/**
 * @typedef {import('@gopeed/types').FileInfo } FileInfo 
 * @typedef {import('gopeed').Resource } OnResovleContext 
 * @typedef {import("@netdisk-sdk/cloud189-sdk").IAppToken} IAppToken
 * @typedef {import("@netdisk-sdk/cloud189-sdk").IAppSession} IAppSession
 * 
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").ICreateClientByType} ICreateClientByType
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IFile} IFile 
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IShareFile} IShareFile 
 * @typedef {import("@netdisk-sdk/quarkuc-sdk").IFidExtend} IFidExtend  
*/

/**
 * @typedef { (pdir_fid: IFidExtend) => AsyncGenerator<IShareFile, void, undefined> } FFileIter
 */

import { QuarkUCClient, getFileFid } from "@netdisk-sdk/quarkuc-sdk";
import superagent from "superagent"; superagent.getXHR = () => new XMLHttpRequest()
import merge from "lodash.merge";
import { xxHash32 } from "js-xxhash";

gopeed.events.onResolve(async (ctx) => {
  try {
    const url = decodeURI(ctx.req.url)

    /** @type {string[]} */
    const [, type, code] = url.match(/(uc|quark)\.cn\/s\/([a-z0-9]*)/i) || []
    /** @type {[,?string]} */
    const [, pdir_fid = '0'] = url.match(/#\/list\/share\/.*\/([a-z0-9]{32})/) || []
    /** @type {[,?string]} */
    const [, pwd] = url.match(/(?:密码|pwd)\W+([a-z0-9]{4})/i) || []

    gopeed.logger.debug(`[${type}] code: ${code} pwd: ${pwd} pdir_fid:${pdir_fid}`)

    const client = createClient(type)

    const { stoken, title } = await client.shareApi.token(code, pwd)
    const createFileIter = async function* (pdir_fid) {
      let size = 1000, page = 1
      let result
      do {
        result = await client.shareApi.detail(code, stoken, {
          pdir_fid: getFileFid(pdir_fid),
          _size: size,
          _page: page++
        })
        yield* result.list
      } while (result._total > page * size)
    }

    /** @type {FileInfo[]} */
    const files = []
    for await (const item of deepFileList(createFileIter, pdir_fid, 1)) {
      const { file_name, path, size, fid, share_fid_token } = item
      files.push({
        range: true,
        name: file_name,
        path,
        size,
        req: {
          // url: `${type}_share://${fid}`,
          url: `http://${type}/${fid}`, // 占位
          labels: {
            [gopeed.info.identity]: true,
            type,
            fid, share_fid_token,
            stoken, code, pwd,
          }
        }
      })
    }
    ctx.res = { name: title, files: files };
  } catch (error) {
    /** @type {Error} */
    var err = error
    gopeed.logger.error(err.stack)
  }
});

gopeed.events.onStart(async (ctx) => {
  try {
    const { req } = ctx.task.meta
    /** @type {Record<string,string>} */
    const { type, fid, share_fid_token, stoken, code, pwd, self_share } = req.labels
    gopeed.logger.debug(JSON.stringify({ type, fid, share_fid_token, stoken, code, pwd }))

    const client = createClient(type)

    /** 获取自己分享文件的下载链接 */
    const getSelfShare = async () => await client.fsApi.download(fid)
    /** 获取别人分享的下载链接 */
    const getOthersShare = async () => {
      // 转存分享文件
      const { task_id } = await client.shareApi.save(code, stoken, '0', [{ fid, share_fid_token }])
      const result = await client.shareApi.saveTask(task_id, true)
      if (result.status != 2) { throw `转存分享失败: result: ${JSON.stringify(result)} meta: ${JSON.stringify(ctx.task.meta)}` }
      // 获取下载链接
      const [file_fid] = result.save_as.save_as_top_fids;
      const down_result = await client.fsApi.download(file_fid);
      // 删除转存文件
      client.fsApi.delete([file_fid])
        .then(({ task_id }) => client.fsApi.task(task_id, true))
        .catch(err => gopeed.logger.error(err))
      return down_result
    }

    const { download_url } = await (self_share ? getSelfShare() :
      getOthersShare().catch(error => {
        if (error?.__info?.code == 41017) {
          req.labels['self_share'] = true
          return getSelfShare()
        }
        return Promise.reject(error)
      }))

    // 更新下载链接
    req.url = download_url
    const { cookie, ua, referer } = client.config
    req.extra = merge(req.extra, {
      header: {
        "Cookie": cookie,
        "Referer": referer,
        "User-Agent": ua,
      }
    })

    gopeed.logger.debug(JSON.stringify(req))
  } catch (error) {
    /** @type {Error} */
    var err = error
    gopeed.logger.error(err.stack)
  }
})

gopeed.events.onError(async (ctx) => {
  // gopeed.logger.debug(ctx.task.meta)
})

export const createClient = (type) => {
  const { quark_cookie, uc_cookie } = gopeed.settings
  const key = `${type}_cookie`
  const settingCookie = type == 'uc' ? uc_cookie : quark_cookie
  const settingIdentif = xxHash32(settingCookie)

  // 
  let [cookie, identif] = gopeed.storage.get(key)?.split('|') || []
  if (identif != settingIdentif) {
    gopeed.logger.debug(`[${type}] setting cookie update`)
    cookie = settingCookie; identif = settingIdentif;
    gopeed.storage.set(key, [cookie, identif].join('|'))
  }

  /** @type {ICreateClientByType} */
  const config = {
    type,
    cookie: type == 'uc' ? uc_cookie : quark_cookie,
    cookieUpdate: (cookie) => {
      gopeed.logger.debug(`[${type}] storage cookie update, cookie: ${cookie}`)
      gopeed.storage.set(key, [cookie, identif].join('|'))
    }
  }
  const client = new QuarkUCClient(config)
  return client
}

/**
 * 
 * @param {FFileIter} fileIter 
 * @param {IFidExtend} pdir_fid 开始的文件夹 
 * @param {number} depth 
 * 
 * @return { AsyncGenerator<IShareFile&{path:string}, void, undefined> }
 */

export function deepFileList(fileIter, pdir_fid, depth) {
  async function* deepList(path, pdir_fid, currentDepth) {
    for await (const file of fileIter(pdir_fid)) {
      if (file.file_type == 0) {
        if (depth && currentDepth >= depth) continue
        yield* deepList(`${path}${file.file_name}/`, file, currentDepth + 1)

      } else { yield { ...file, path } }
    }
  }
  return deepList('', pdir_fid, 0)
}