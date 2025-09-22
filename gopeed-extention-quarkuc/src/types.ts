export interface IFileCommonLabels {
    type: 'uc'|'quark',
    path: string
}

export interface IPersonFileLabels extends IFileCommonLabels {
    fid: string,
}

export interface IShareFileLabels extends IFileCommonLabels {
    fid: string,
    share_fid_token: string,
    self_share?:boolean,

    code: string,
    stoken: string,
    pwd: string,
}