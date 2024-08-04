export type IFileCommonLabels = {
    /** 完整文件路径 */
    path: string
    /**文件md5 */
    md5: string
    /** 文件大小 */
    size: number

    ctime?: number
    mtime?: number
}

import { ITransferShareParam, IShareParam } from '@netdisk-sdk/baidu-sdk';

export type IShareFileLabels = IFileCommonLabels & IShareParam & ITransferShareParam & {
    fid: string
}

export type IPersonFileLabels = IFileCommonLabels & {
    fid: string
}